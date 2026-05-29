import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { sseBus } from "../sse-bus"
import { createExtensionApi } from "./api"
import { parseManifest } from "./manifest"
import type { ExtensionPermissions } from "./manifest"
import { checkGrants } from "./permissions"
import { extensionRegistry } from "./registry"
import type { ExtensionRegistry, ExtensionScope } from "./registry"
import { defaultStateFile, grantsAsPermissions, grantsFor, isEnabled, readState } from "./state"
import type { ExtensionState } from "./state"

export type ExtensionImporter = (
  absPath: string,
) => Promise<{ default?: (...args: never[]) => unknown }>

export type LoadExtensionsOptions = {
  roots?: { global?: string; local?: string }
  registry?: ExtensionRegistry
  granted?: ExtensionPermissions
  importer?: ExtensionImporter
  stateFile?: string
  state?: ExtensionState
}

export type LoadExtensionsResult = {
  loaded: string[]
  skipped: { name: string; reason: string }[]
}

const defaultGlobalRoot = (): string =>
  process.env.PID_EXT_GLOBAL_DIR ?? join(homedir(), ".pid/extensions")
const defaultLocalRoot = (): string =>
  process.env.PID_EXT_LOCAL_DIR ?? join(process.cwd(), ".pid/extensions")

const defaultImporter: ExtensionImporter = (p) => import(p)

type Candidate = { dir: string; scope: ExtensionScope }

// List immediate subdirectories of a root that contain a manifest.json.
const scanRoot = (root: string, scope: ExtensionScope): Candidate[] => {
  let entries: string[]
  try {
    entries = readdirSync(root)
  } catch {
    return []
  }
  const out: Candidate[] = []
  for (const name of entries) {
    const dir = join(root, name)
    try {
      if (!statSync(dir).isDirectory()) continue
      statSync(join(dir, "manifest.json"))
    } catch {
      continue
    }
    out.push({ dir, scope })
  }
  return out
}

export const loadExtensions = async (
  opts: LoadExtensionsOptions = {},
): Promise<LoadExtensionsResult> => {
  const registry = opts.registry ?? extensionRegistry
  const granted = opts.granted ?? {}
  const importer = opts.importer ?? defaultImporter
  const globalRoot = opts.roots?.global ?? defaultGlobalRoot()
  const localRoot = opts.roots?.local ?? defaultLocalRoot()
  const state: ExtensionState = opts.state ?? readState(opts.stateFile ?? defaultStateFile())

  // Global first, local second: when reduced by name, local overrides global.
  const candidates = [...scanRoot(globalRoot, "global"), ...scanRoot(localRoot, "local")]

  const loaded: string[] = []
  const skipped: { name: string; reason: string }[] = []

  const skip = (name: string, reason: string): void => {
    skipped.push({ name, reason })
    sseBus.publish({ type: "ext:skipped", data: { name, reason } })
  }

  // De-dupe by name keeping the LAST candidate (local wins over global).
  const byName = new Map<string, Candidate>()
  const order: string[] = []
  for (const cand of candidates) {
    let rawText: string
    try {
      rawText = readFileSync(join(cand.dir, "manifest.json"), "utf8")
    } catch (err) {
      skip(cand.dir, `manifest read failed: ${String(err)}`)
      continue
    }
    let raw: unknown
    try {
      raw = JSON.parse(rawText)
    } catch (err) {
      skip(cand.dir, `manifest parse failed: ${String(err)}`)
      continue
    }
    const parsed = parseManifest(raw)
    if (!parsed.ok) {
      skip(cand.dir, parsed.error)
      continue
    }
    const name = parsed.value.name
    if (!byName.has(name)) order.push(name)
    byName.set(name, cand)
  }

  for (const name of order) {
    const cand = byName.get(name)
    if (!cand) continue

    // Disabled extensions are skipped entirely — not registered, not imported.
    if (!isEnabled(state, name)) {
      skip(name, "disabled")
      continue
    }

    // Re-parse the winning candidate's manifest.
    const raw = JSON.parse(readFileSync(join(cand.dir, "manifest.json"), "utf8"))
    const parsed = parseManifest(raw)
    if (!parsed.ok) {
      skip(name, parsed.error)
      continue
    }
    const manifest = parsed.value

    // Merge caller-provided grants with per-ext grants from state (union).
    const stateGrants = grantsAsPermissions(grantsFor(state, name))
    const mergedGranted: ExtensionPermissions = {
      fs: [...(granted.fs ?? []), ...(stateGrants.fs ?? [])],
      exec: [...(granted.exec ?? []), ...(stateGrants.exec ?? [])],
      net: [...(granted.net ?? []), ...(stateGrants.net ?? [])],
      events: (granted.events ?? false) || (stateGrants.events ?? false),
    }

    const grant = checkGrants(manifest, mergedGranted)
    if (!grant.ok) {
      skip(name, `missing permissions: ${grant.missing.join(", ")}`)
      continue
    }

    const api = createExtensionApi({
      manifest,
      dir: cand.dir,
      registry,
      granted: mergedGranted,
      scope: cand.scope,
    })

    // The daemon entry is OPTIONAL: iframe-tier (UI-only) extensions often ship
    // no daemon.ts. Only import when the entry file actually exists on disk. A
    // missing entry means "no daemon-side logic" — still register the extension
    // so it lists and serves its static assets. An entry that exists but throws
    // is a real failure and skips the extension.
    const entryPath = join(cand.dir, manifest.daemonEntry ?? "daemon.ts")
    if (existsSync(entryPath)) {
      try {
        const mod = await importer(entryPath)
        if (typeof mod.default === "function") {
          await (mod.default as (a: unknown) => unknown)(api)
        }
      } catch (err) {
        skip(name, String(err instanceof Error ? err.message : err))
        continue
      }
    }

    // Ensure the ext is registered even if it registered no route (so it shows
    // in /extensions and can serve static assets). registerRoute already
    // registers an app-bearing entry; only register a plain entry if absent.
    if (!registry.get(name)) {
      registry.register({ manifest, dir: cand.dir, scope: cand.scope })
    }
    loaded.push(name)
  }

  return { loaded, skipped }
}
