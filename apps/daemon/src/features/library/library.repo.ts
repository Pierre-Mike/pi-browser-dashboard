import { readFile, readdir, stat } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { Context, Effect, Layer } from "effect"
import { ConfigService } from "../../platform/config.repo"
import { ProjectsService } from "../projects/projects.repo"
import {
  type Catalog,
  CatalogParseError,
  type InstallStatus,
  LIBRARY_CATEGORIES,
  type LibraryCategory,
  type LibraryEntry,
  expandHome,
  parseCatalog,
} from "./library.core"

export type LibraryError =
  | "catalog_not_found"
  | "catalog_invalid"
  | "not_found"
  | "forbidden"
  | "agentic_repo_missing"

export type StatusByScope = { readonly global: InstallStatus; readonly local: InstallStatus }

export type CatalogBundle = {
  readonly catalog: Catalog
  readonly catalogPath: string
  readonly statusByName: Record<string, StatusByScope>
}

export type AgenticItem = {
  readonly name: string
  readonly path: string
  readonly registered: boolean
}

export type AgenticListing = {
  readonly repoPath: string
  readonly category: LibraryCategory
  readonly items: readonly AgenticItem[]
}

export type LibraryServiceApi = {
  readonly readCatalog: (
    projectId: string | null,
  ) => Effect.Effect<CatalogBundle, LibraryError, never>
  readonly listAgenticRepo: (
    category: LibraryCategory,
  ) => Effect.Effect<AgenticListing, LibraryError, never>
}

export class LibraryService extends Context.Tag("LibraryService")<
  LibraryService,
  LibraryServiceApi
>() {}

const DEFAULT_AGENTIC_REPO = "/Users/pierre-mikel/Github/agentic"
const DEFAULT_LIBRARY_DIR = "~/.claude/skills/library/"
const DEFAULT_CATALOG_PATH = "library.yaml"

const tryReadText = async (path: string): Promise<string | null> => {
  try {
    return await readFile(path, "utf8")
  } catch {
    return null
  }
}

const tryStat = async (path: string) => {
  try {
    return await stat(path)
  } catch {
    return null
  }
}

const listDirs = async (dir: string): Promise<readonly string[]> => {
  const entries = await readdir(dir).catch(() => [] as string[])
  const out: string[] = []
  for (const name of entries) {
    if (name.startsWith(".")) continue
    const s = await tryStat(join(dir, name))
    if (s?.isDirectory()) out.push(name)
  }
  out.sort()
  return out
}

// Per-category install probe: is `<scopeDir>/<entryName>` a directory?
// We only check the parent dir's existence cheaply via a single readdir per
// scope+category, so install-status lookups stay O(catalog) on disk.
const probeScope = async (
  baseDir: string,
  names: readonly string[],
): Promise<Map<string, InstallStatus>> => {
  const out = new Map<string, InstallStatus>()
  const dirEntries = new Set(await readdir(baseDir).catch(() => [] as string[]))
  for (const n of names) {
    out.set(n, dirEntries.has(n) ? "installed" : "not_installed")
  }
  return out
}

const computeStatusByName = async (
  catalog: Catalog,
  homeDir: string,
  projectRoot: string | null,
): Promise<Record<string, StatusByScope>> => {
  const byCategory = new Map<LibraryCategory, LibraryEntry[]>()
  for (const e of catalog.entries) {
    const list = byCategory.get(e.type) ?? []
    list.push(e)
    byCategory.set(e.type, list)
  }
  const out: Record<string, StatusByScope> = {}
  for (const category of LIBRARY_CATEGORIES) {
    const entries = byCategory.get(category) ?? []
    if (entries.length === 0) continue
    const dirs = catalog.defaultDirs[category]
    const globalDir = expandHome(dirs.global, homeDir)
    const localDir = projectRoot ? join(projectRoot, dirs.default) : null
    const [globalMap, localMap] = await Promise.all([
      probeScope(
        globalDir,
        entries.map((e) => e.name),
      ),
      localDir
        ? probeScope(
            localDir,
            entries.map((e) => e.name),
          )
        : Promise.resolve(new Map<string, InstallStatus>()),
    ])
    for (const e of entries) {
      out[`${e.type}:${e.name}`] = {
        global: globalMap.get(e.name) ?? "not_installed",
        local: localMap.get(e.name) ?? "not_installed",
      }
    }
  }
  return out
}

type ReadCatalogResult =
  | { readonly _tag: "ok"; readonly catalog: Catalog; readonly catalogPath: string }
  | { readonly _tag: "err"; readonly error: LibraryError }

const readCatalogFile = async (catalogPath: string): Promise<ReadCatalogResult> => {
  const text = await tryReadText(catalogPath)
  if (text === null) return { _tag: "err", error: "catalog_not_found" }
  try {
    const catalog = parseCatalog(text)
    return { _tag: "ok", catalog, catalogPath }
  } catch (e) {
    if (e instanceof CatalogParseError) return { _tag: "err", error: "catalog_invalid" }
    return { _tag: "err", error: "catalog_invalid" }
  }
}

export const LibraryRepoLive: Layer.Layer<LibraryService, never, ConfigService | ProjectsService> =
  Layer.effect(
    LibraryService,
    Effect.gen(function* () {
      const cfg = yield* ConfigService
      const projects = yield* ProjectsService
      const config = yield* cfg.get()
      const homeDir = homedir()

      const libraryDir = process.env.PID_LIBRARY_DIR ?? expandHome(DEFAULT_LIBRARY_DIR, homeDir)
      const catalogPath = join(libraryDir, DEFAULT_CATALOG_PATH)

      const agenticRepoPath = process.env.PID_AGENTIC_REPO_PATH ?? DEFAULT_AGENTIC_REPO

      const resolveProjectRoot = (projectId: string | null) =>
        Effect.gen(function* () {
          if (projectId === null) return null
          const list = yield* projects.list()
          const proj = list.find((p) => p.id === projectId)
          if (!proj) return yield* Effect.fail<LibraryError>("not_found")
          return proj.path
        })

      return {
        readCatalog: (projectId) =>
          Effect.gen(function* () {
            const projectRoot = yield* resolveProjectRoot(projectId)
            const result = yield* Effect.promise(() => readCatalogFile(catalogPath))
            if (result._tag === "err") return yield* Effect.fail(result.error)
            const statusByName = yield* Effect.promise(() =>
              computeStatusByName(result.catalog, homeDir, projectRoot),
            )
            return {
              catalog: result.catalog,
              catalogPath: result.catalogPath,
              statusByName,
            }
          }),

        listAgenticRepo: (category) =>
          Effect.gen(function* () {
            const dir = join(agenticRepoPath, category)
            const dirStat = yield* Effect.promise(() => tryStat(agenticRepoPath))
            if (!dirStat?.isDirectory()) {
              return yield* Effect.fail<LibraryError>("agentic_repo_missing")
            }
            const names = yield* Effect.promise(() => listDirs(dir))
            const cat = yield* Effect.promise(() => readCatalogFile(catalogPath))
            const registered = new Set<string>()
            if (cat._tag === "ok") {
              for (const e of cat.catalog.entries) {
                if (e.type === category) registered.add(e.name)
              }
            }
            const items: AgenticItem[] = names.map((name) => ({
              name,
              path: join(dir, name),
              registered: registered.has(name),
            }))
            return { repoPath: agenticRepoPath, category, items }
          }),
      }
    }),
  )

export const LibraryRepoTest = (
  fixtures: {
    readonly catalog?: CatalogBundle
    readonly agentic?: Partial<Record<LibraryCategory, AgenticListing>>
  } = {},
): Layer.Layer<LibraryService> =>
  Layer.succeed(LibraryService, {
    readCatalog: () =>
      fixtures.catalog
        ? Effect.succeed(fixtures.catalog)
        : Effect.fail<LibraryError>("catalog_not_found"),
    listAgenticRepo: (category) => {
      const a = fixtures.agentic?.[category]
      return a ? Effect.succeed(a) : Effect.fail<LibraryError>("agentic_repo_missing")
    },
  })
