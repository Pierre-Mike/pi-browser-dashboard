// Imperative shell for pid-apps: discovers HTML apps under <project>/.pid/ and
// resolves their assets for streaming. The pure rules live in pid-apps.core.ts;
// the security guards added here are the realpath containment check (symlink
// escape) and the default-app reserved-internal exclusion. Mirrors
// pid-settings.repo.ts (Effect Layer over ProjectsService).

import { readdir, readFile, realpath, stat } from "node:fs/promises"
import { join, sep } from "node:path"
import { Context, Effect, Layer } from "effect"
import { mimeFromPath, resolveProjectPath } from "../projects/projects.core"
import { ProjectsService, resolveProjectDir } from "../projects/projects.repo"
import {
  applyPidAppManifest,
  appRootFor,
  DEFAULT_APP_ID,
  DEFAULT_ENTRY,
  discoverPidApps,
  isReservedDefaultAsset,
  isValidAppId,
  type PidApp,
  type PidAppDirEntry,
  parsePidAppManifest,
} from "./pid-apps.core"

export type PidAppError = "not_found" | "forbidden" | "too_large"

type PidAppAsset = {
  readonly absPath: string
  readonly size: number
  readonly mime: string
}

type AssetResult = { ok: true; value: PidAppAsset } | { ok: false; error: PidAppError }

// Identifies one asset within a project: which app, and the path under its root.
type AssetRef = { readonly appId: string; readonly rel: string }

const PID_DIR = ".pid"
const PID_APP_MANIFEST = "pid-app.json"
const MAX_PID_APP_BYTES = 50_000_000 // 50 MB, matching the project /raw cap
const MAX_PID_APP_DIRS = 100 // bound discovery work on a pathological .pid/

type PidAppsServiceApi = {
  readonly listApps: (projectId: string) => Effect.Effect<readonly PidApp[], PidAppError, never>
  readonly resolveAsset: (
    projectId: string,
    ref: AssetRef,
  ) => Effect.Effect<PidAppAsset, PidAppError, never>
}

export class PidAppsService extends Context.Tag("PidAppsService")<
  PidAppsService,
  PidAppsServiceApi
>() {}

const tryReadText = async (path: string): Promise<string | null> => {
  try {
    return await readFile(path, "utf8")
  } catch {
    return null
  }
}

const isFileAt = async (path: string): Promise<boolean> => {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

const realPathOrNull = async (path: string): Promise<string | null> => {
  try {
    return await realpath(path)
  } catch {
    return null
  }
}

const isWithin = (root: string, child: string): boolean =>
  child === root || child.startsWith(root + sep)

// --- discovery (listApps) ---

const probeEntry = async (pidDir: string, name: string): Promise<PidAppDirEntry> => ({
  name,
  isDir: true,
  hasIndexHtml: await isFileAt(join(pidDir, name, DEFAULT_ENTRY)),
})

const withManifest = async (pidDir: string, app: PidApp): Promise<PidApp> => {
  const text = await tryReadText(join(pidDir, app.root, PID_APP_MANIFEST))
  return applyPidAppManifest(app, parsePidAppManifest(text))
}

const discoverApps = async (pidDir: string): Promise<readonly PidApp[]> => {
  let dirents: { name: string; isDirectory: () => boolean }[]
  try {
    dirents = await readdir(pidDir, { withFileTypes: true })
  } catch {
    return []
  }
  const dirNames = dirents
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .slice(0, MAX_PID_APP_DIRS)
  const entries = await Promise.all(dirNames.map((n) => probeEntry(pidDir, n)))
  const hasRootIndex = await isFileAt(join(pidDir, DEFAULT_ENTRY))
  const apps = discoverPidApps(entries, hasRootIndex)
  return Promise.all(apps.map((app) => withManifest(pidDir, app)))
}

// --- asset resolution (resolveAsset) ---

// The HTML file served for a bare "/<appId>/" request: the manifest entry
// override, else index.html.
const entryFor = async (appRoot: string): Promise<string> => {
  const text = await tryReadText(join(appRoot, PID_APP_MANIFEST))
  return parsePidAppManifest(text).entry ?? DEFAULT_ENTRY
}

const effectiveRel = async (appRoot: string, rel: string): Promise<string> =>
  rel === "" || rel === "/" ? await entryFor(appRoot) : rel

// Lexical containment + the default-app reserved-internal exclusion. Returns the
// resolved paths, or null when the request must be refused.
const safeResolve = (
  appRoot: string,
  ref: AssetRef,
): { absPath: string; relPath: string } | null => {
  const r = resolveProjectPath(appRoot, ref.rel)
  if (!r.ok) return null
  if (ref.appId === DEFAULT_APP_ID && isReservedDefaultAsset(r.relPath)) return null
  return { absPath: r.absPath, relPath: r.relPath }
}

// realpath containment: refuse a symlink that escapes the app root. The drop
// zone is untrusted, so the lexical guard alone is insufficient.
const containedRealPath = async (appRoot: string, absPath: string): Promise<string | null> => {
  const [real, realRoot] = await Promise.all([realPathOrNull(absPath), realPathOrNull(appRoot)])
  if (real === null || realRoot === null) return null
  return isWithin(realRoot, real) ? real : null
}

type StatResult = { ok: true; size: number } | { ok: false; error: PidAppError }

// Stat the lexical path (following symlinks): missing/non-file -> not_found,
// oversize -> too_large. Runs BEFORE the realpath guard so a genuinely absent
// file reports not_found rather than forbidden.
const statAsset = async (absPath: string): Promise<StatResult> => {
  let s: Awaited<ReturnType<typeof stat>>
  try {
    s = await stat(absPath)
  } catch {
    return { ok: false, error: "not_found" }
  }
  if (!s.isFile()) return { ok: false, error: "not_found" }
  if (s.size > MAX_PID_APP_BYTES) return { ok: false, error: "too_large" }
  return { ok: true, size: s.size }
}

const resolveAppFile = async (appRoot: string, ref: AssetRef): Promise<AssetResult> => {
  const rel = await effectiveRel(appRoot, ref.rel)
  const safe = safeResolve(appRoot, { appId: ref.appId, rel })
  if (!safe) return { ok: false, error: "forbidden" }
  const sized = await statAsset(safe.absPath)
  if (!sized.ok) return sized
  const real = await containedRealPath(appRoot, safe.absPath)
  if (real === null) return { ok: false, error: "forbidden" }
  return { ok: true, value: { absPath: real, size: sized.size, mime: mimeFromPath(safe.relPath) } }
}

export const PidAppsRepoLive: Layer.Layer<PidAppsService, never, ProjectsService> = Layer.effect(
  PidAppsService,
  Effect.gen(function* () {
    const projects = yield* ProjectsService
    return {
      listApps: (projectId) =>
        Effect.gen(function* () {
          const projectPath = yield* resolveProjectDir(projects, projectId)
          return yield* Effect.promise(() => discoverApps(join(projectPath, PID_DIR)))
        }),

      resolveAsset: (projectId, ref) =>
        Effect.gen(function* () {
          if (!isValidAppId(ref.appId)) return yield* Effect.fail<PidAppError>("not_found")
          const projectPath = yield* resolveProjectDir(projects, projectId)
          const appRoot = join(projectPath, PID_DIR, appRootFor(ref.appId))
          const res = yield* Effect.promise(() => resolveAppFile(appRoot, ref))
          if (!res.ok) return yield* Effect.fail<PidAppError>(res.error)
          return res.value
        }),
    }
  }),
)
