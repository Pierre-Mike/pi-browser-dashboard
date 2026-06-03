import { readdir, readFile, stat, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { Context, Effect, Layer } from "effect"
import { ConfigService } from "../../platform/config.repo"
import { ProjectsService } from "../projects/projects.repo"
import {
  copyDir,
  GitClient,
  type GitClientApi,
  type GitError,
  makeTempDir,
  removeDir,
} from "./installer"
import {
  type Catalog,
  CatalogParseError,
  DuplicateEntryError,
  expandHome,
  type InstallStatus,
  isSafeSegment,
  LIBRARY_CATEGORIES,
  type LibraryCategory,
  type LibraryEntry,
  parseCatalog,
  parseCatalogDocument,
  parseSource,
  RequiresCycleError,
  removeEntryFromDocument,
  resolveRequires,
  serializeCatalogDocument,
  upsertEntryInDocument,
} from "./library.core"

export type LibraryError =
  | "catalog_not_found"
  | "catalog_invalid"
  | "not_found"
  | "forbidden"
  | "agentic_repo_missing"
  | "source_invalid"
  | "requires_cycle"
  | "duplicate_entry"
  | "git_failed"
  | "io_failed"
  | "already_initialized"

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

export type InstallScope = "global" | "local"

export type InstallInput = {
  readonly name: string
  readonly type: LibraryCategory
  readonly scope: InstallScope
  readonly projectId?: string | null
}

export type InstallResult = {
  readonly installed: readonly string[]
  readonly destinations: readonly string[]
}

export type AddInput = {
  readonly name: string
  readonly type: LibraryCategory
  readonly description: string
  readonly source: string
  readonly requires?: readonly string[]
}

export type RemoveInput = {
  readonly name: string
  readonly type: LibraryCategory
  readonly deleteLocal: boolean
  readonly scope: InstallScope
  readonly projectId?: string | null
}

export type PushInput = {
  readonly name: string
  readonly type: LibraryCategory
  readonly scope: InstallScope
  readonly projectId?: string | null
}

export type SyncInput = {
  readonly scope?: InstallScope
  readonly projectId?: string | null
}

export type SyncOutcome = {
  readonly name: string
  readonly type: LibraryCategory
  readonly scope: InstallScope
  readonly ok: boolean
  readonly error?: string
}

export type InitInput = {
  readonly repoUrl: string
  readonly branch?: string
}

export type LibraryServiceApi = {
  readonly initLibrary: (
    input: InitInput,
  ) => Effect.Effect<{ readonly catalogPath: string }, LibraryError, never>
  readonly readCatalog: (
    projectId: string | null,
  ) => Effect.Effect<CatalogBundle, LibraryError, never>
  readonly listAgenticRepo: (
    category: LibraryCategory,
  ) => Effect.Effect<AgenticListing, LibraryError, never>
  readonly installEntry: (input: InstallInput) => Effect.Effect<InstallResult, LibraryError, never>
  readonly addEntry: (input: AddInput) => Effect.Effect<LibraryEntry, LibraryError, never>
  readonly pushEntry: (
    input: PushInput,
  ) => Effect.Effect<{ readonly commitSha: string }, LibraryError, never>
  readonly removeEntry: (input: RemoveInput) => Effect.Effect<void, LibraryError, never>
  readonly syncAll: (
    input: SyncInput,
  ) => Effect.Effect<{ readonly outcomes: readonly SyncOutcome[] }, LibraryError, never>
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

const computeStatusByName = async ({
  catalog,
  homeDir,
  projectRoot,
}: {
  catalog: Catalog
  homeDir: string
  projectRoot: string | null
}): Promise<Record<string, StatusByScope>> => {
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

// Resolve the destination directory for a (category, scope) pair. For local
// scope a project root must be supplied; for global it uses ~ expansion.
const resolveDestDir = ({
  catalog,
  category,
  scope,
  homeDir,
  projectRoot,
}: {
  catalog: Catalog
  category: LibraryCategory
  scope: InstallScope
  homeDir: string
  projectRoot: string | null
}): string | LibraryError => {
  const dirs = catalog.defaultDirs[category]
  if (scope === "global") return expandHome(dirs.global, homeDir)
  if (!projectRoot) return "not_found"
  return join(projectRoot, dirs.default)
}

const installOne = async ({
  entry,
  catalog,
  scope,
  homeDir,
  projectRoot,
  git,
}: {
  entry: LibraryEntry
  catalog: Catalog
  scope: InstallScope
  homeDir: string
  projectRoot: string | null
  git: GitClientApi
}): Promise<{ ok: true; dest: string } | { ok: false; error: LibraryError; message?: string }> => {
  if (!isSafeSegment(entry.name)) return { ok: false, error: "forbidden" }
  const destOrErr = resolveDestDir({ catalog, category: entry.type, scope, homeDir, projectRoot })
  if (typeof destOrErr !== "string" || destOrErr.length === 0) {
    return { ok: false, error: destOrErr as LibraryError }
  }
  const destPath = join(destOrErr, entry.name)
  const parsed = parseSource(entry.source, homeDir)
  if (!parsed) return { ok: false, error: "source_invalid", message: entry.source }
  try {
    if (parsed.kind === "local") {
      const dir = parsed.dir || dirname(parsed.absPath)
      await copyDir(dir, destPath)
      return { ok: true, dest: destPath }
    }
    // GitHub: clone into a temp dir, then copy the referenced subdirectory.
    const tmp = await makeTempDir("pid-lib-install")
    try {
      const cloneResult = await Effect.runPromise(
        git
          .clone({ url: parsed.cloneUrl, dst: tmp, opts: { depth: 1, branch: parsed.branch } })
          .pipe(Effect.either),
      )
      if (cloneResult._tag === "Left") {
        return { ok: false, error: "git_failed", message: cloneResult.left.message }
      }
      const subDir = parsed.dir === "" ? tmp : join(tmp, parsed.dir)
      await copyDir(subDir, destPath)
      return { ok: true, dest: destPath }
    } finally {
      await removeDir(tmp)
    }
  } catch (e) {
    return {
      ok: false,
      error: "io_failed",
      message: e instanceof Error ? e.message : String(e),
    }
  }
}

export const LibraryRepoLive: Layer.Layer<
  LibraryService,
  never,
  ConfigService | ProjectsService | GitClient
> = Layer.effect(
  LibraryService,
  Effect.gen(function* () {
    const cfg = yield* ConfigService
    const projects = yield* ProjectsService
    const git = yield* GitClient
    yield* cfg.get()
    const homeDir = homedir()

    const libraryDir = process.env.PID_LIBRARY_DIR ?? expandHome(DEFAULT_LIBRARY_DIR, homeDir)
    const catalogPath = join(libraryDir, DEFAULT_CATALOG_PATH)
    const agenticRepoPath = process.env.PID_AGENTIC_REPO_PATH ?? DEFAULT_AGENTIC_REPO

    const resolveProjectRoot = (projectId: string | null | undefined) =>
      Effect.gen(function* () {
        if (projectId === null || projectId === undefined) return null
        const list = yield* projects.list()
        const proj = list.find((p) => p.id === projectId)
        if (!proj) return yield* Effect.fail<LibraryError>("not_found")
        return proj.path
      })

    // Read-modify-write the catalog. Pulls first to minimise the chance of
    // a non-fast-forward push, then mutates the YAML Document in place, then
    // writes + commits + pushes.
    const mutateCatalog = (
      mutate: (text: string) => string | LibraryError,
      commitMessage: string,
    ) =>
      Effect.gen(function* () {
        yield* git
          .pullFastForward(libraryDir)
          .pipe(
            Effect.catchTag("GitError", (e: GitError) =>
              Effect.fail<LibraryError>(
                e.stderr?.toLowerCase().includes("not a git repository")
                  ? "catalog_not_found"
                  : "git_failed",
              ),
            ),
          )
        const text = yield* Effect.tryPromise({
          try: () => readFile(catalogPath, "utf8"),
          catch: (): LibraryError => "catalog_not_found",
        })
        const next = mutate(text)
        if (typeof next !== "string") return yield* Effect.fail<LibraryError>(next)
        yield* Effect.tryPromise({
          try: () => writeFile(catalogPath, next, "utf8"),
          catch: (): LibraryError => "io_failed",
        })
        yield* git
          .commitAndPush({ dir: libraryDir, files: [DEFAULT_CATALOG_PATH], message: commitMessage })
          .pipe(Effect.catchTag("GitError", () => Effect.fail<LibraryError>("git_failed")))
      })

    const readCatalogEffect = (projectId: string | null | undefined) =>
      Effect.gen(function* () {
        const projectRoot = yield* resolveProjectRoot(projectId)
        const result = yield* Effect.promise(() => readCatalogFile(catalogPath))
        if (result._tag === "err") return yield* Effect.fail(result.error)
        const statusByName = yield* Effect.promise(() =>
          computeStatusByName({ catalog: result.catalog, homeDir, projectRoot }),
        )
        return {
          catalog: result.catalog,
          catalogPath: result.catalogPath,
          statusByName,
          projectRoot,
        }
      })

    return {
      // First-time setup (the skill's `/library install`): clone a library repo
      // into the library dir. Refuses if a catalog is already present so we never
      // clobber an existing install. The cloned repo must contain a library.yaml.
      initLibrary: (input) =>
        Effect.gen(function* () {
          const existing = yield* Effect.promise(() => tryReadText(catalogPath))
          if (existing !== null) return yield* Effect.fail<LibraryError>("already_initialized")
          const tmp = yield* Effect.promise(() => makeTempDir("pid-lib-init"))
          const cleanup = Effect.promise(() => removeDir(tmp))
          return yield* Effect.gen(function* () {
            yield* git
              .clone({
                url: input.repoUrl,
                dst: tmp,
                opts: {
                  depth: 1,
                  ...(input.branch ? { branch: input.branch } : {}),
                },
              })
              .pipe(Effect.catchTag("GitError", () => Effect.fail<LibraryError>("git_failed")))
            const clonedCatalog = yield* Effect.promise(() =>
              tryReadText(join(tmp, DEFAULT_CATALOG_PATH)),
            )
            if (clonedCatalog === null) return yield* Effect.fail<LibraryError>("source_invalid")
            try {
              parseCatalog(clonedCatalog)
            } catch {
              return yield* Effect.fail<LibraryError>("catalog_invalid")
            }
            yield* Effect.tryPromise({
              try: () => copyDir(tmp, libraryDir),
              catch: (): LibraryError => "io_failed",
            })
            return { catalogPath }
          }).pipe(Effect.ensuring(cleanup))
        }),

      readCatalog: (projectId) =>
        Effect.map(readCatalogEffect(projectId), ({ catalog, catalogPath, statusByName }) => ({
          catalog,
          catalogPath,
          statusByName,
        })),

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

      installEntry: (input) =>
        Effect.gen(function* () {
          if (!isSafeSegment(input.name)) return yield* Effect.fail<LibraryError>("forbidden")
          const { catalog, projectRoot } = yield* readCatalogEffect(input.projectId)
          let chain: readonly LibraryEntry[]
          try {
            chain = resolveRequires(input.name, catalog).filter((e) =>
              e.name === input.name ? e.type === input.type : true,
            )
          } catch (e) {
            if (e instanceof RequiresCycleError) {
              return yield* Effect.fail<LibraryError>("requires_cycle")
            }
            return yield* Effect.fail<LibraryError>("catalog_invalid")
          }
          if (chain.length === 0) return yield* Effect.fail<LibraryError>("not_found")
          if (input.scope === "local" && !projectRoot) {
            return yield* Effect.fail<LibraryError>("not_found")
          }
          const installed: string[] = []
          const destinations: string[] = []
          for (const e of chain) {
            const result = yield* Effect.promise(() =>
              installOne({ entry: e, catalog, scope: input.scope, homeDir, projectRoot, git }),
            )
            if (!result.ok) {
              return yield* Effect.fail<LibraryError>(result.error)
            }
            installed.push(e.name)
            destinations.push(result.dest)
          }
          return { installed, destinations }
        }),

      addEntry: (input) =>
        Effect.gen(function* () {
          if (!isSafeSegment(input.name)) return yield* Effect.fail<LibraryError>("forbidden")
          let captured: LibraryEntry | null = null
          yield* mutateCatalog((text) => {
            const doc = parseCatalogDocument(text)
            try {
              upsertEntryInDocument({
                doc,
                entry: {
                  name: input.name,
                  type: input.type,
                  description: input.description,
                  source: input.source,
                  ...(input.requires && input.requires.length > 0
                    ? { requires: input.requires }
                    : {}),
                },
              })
            } catch (e) {
              if (e instanceof DuplicateEntryError) return "duplicate_entry" as LibraryError
              return "catalog_invalid" as LibraryError
            }
            captured = {
              name: input.name,
              type: input.type,
              description: input.description,
              source: input.source,
              ...(input.requires && input.requires.length > 0 ? { requires: input.requires } : {}),
            }
            return serializeCatalogDocument(doc)
          }, `library: add ${input.type}:${input.name}`)
          if (!captured) return yield* Effect.fail<LibraryError>("catalog_invalid")
          return captured as LibraryEntry
        }),

      pushEntry: (input) =>
        Effect.gen(function* () {
          if (!isSafeSegment(input.name)) return yield* Effect.fail<LibraryError>("forbidden")
          const { catalog, projectRoot } = yield* readCatalogEffect(input.projectId)
          const entry = catalog.entries.find((e) => e.name === input.name && e.type === input.type)
          if (!entry) return yield* Effect.fail<LibraryError>("not_found")
          if (input.scope === "local" && !projectRoot) {
            return yield* Effect.fail<LibraryError>("not_found")
          }
          const destOrErr = resolveDestDir({
            catalog,
            category: input.type,
            scope: input.scope,
            homeDir,
            projectRoot,
          })
          if (typeof destOrErr !== "string") {
            return yield* Effect.fail<LibraryError>(destOrErr)
          }
          const localInstall = join(destOrErr, input.name)
          const parsed = parseSource(entry.source, homeDir)
          if (!parsed) return yield* Effect.fail<LibraryError>("source_invalid")

          if (parsed.kind === "local") {
            // Source is just a local path: copy local install → source dir.
            yield* Effect.tryPromise({
              try: () => copyDir(localInstall, parsed.dir),
              catch: (): LibraryError => "io_failed",
            })
            return { commitSha: "" }
          }

          // GitHub: clone, overwrite the sub-dir with the local install, commit+push.
          const tmp = yield* Effect.promise(() => makeTempDir("pid-lib-push"))
          try {
            yield* git
              .clone({ url: parsed.cloneUrl, dst: tmp, opts: { depth: 1, branch: parsed.branch } })
              .pipe(Effect.catchTag("GitError", () => Effect.fail<LibraryError>("git_failed")))
            const subDir = parsed.dir === "" ? tmp : join(tmp, parsed.dir)
            yield* Effect.tryPromise({
              try: () => copyDir(localInstall, subDir),
              catch: (): LibraryError => "io_failed",
            })
            const sha = yield* git
              .commitAndPush({
                dir: tmp,
                files: [parsed.dir || "."],
                message: `library: push ${input.type}:${input.name}`,
              })
              .pipe(Effect.catchTag("GitError", () => Effect.fail<LibraryError>("git_failed")))
            return { commitSha: sha }
          } finally {
            yield* Effect.promise(() => removeDir(tmp))
          }
        }),

      removeEntry: (input) =>
        Effect.gen(function* () {
          if (!isSafeSegment(input.name)) return yield* Effect.fail<LibraryError>("forbidden")
          yield* mutateCatalog((text) => {
            const doc = parseCatalogDocument(text)
            const removed = removeEntryFromDocument({ doc, name: input.name, type: input.type })
            if (!removed) return "not_found" as LibraryError
            return serializeCatalogDocument(doc)
          }, `library: remove ${input.type}:${input.name}`)

          if (input.deleteLocal) {
            const { catalog, projectRoot } = yield* readCatalogEffect(input.projectId)
            const destOrErr = resolveDestDir({
              catalog,
              category: input.type,
              scope: input.scope,
              homeDir,
              projectRoot,
            })
            if (typeof destOrErr === "string") {
              const target = join(destOrErr, input.name)
              yield* Effect.tryPromise({
                try: () => removeDir(target),
                catch: (): LibraryError => "io_failed",
              })
            }
          }
        }),

      syncAll: (input) =>
        Effect.gen(function* () {
          const { catalog, projectRoot, statusByName } = yield* readCatalogEffect(input.projectId)
          const scopes: InstallScope[] = input.scope ? [input.scope] : ["global", "local"]
          const outcomes: SyncOutcome[] = []
          for (const entry of catalog.entries) {
            for (const scope of scopes) {
              if (scope === "local" && !projectRoot) continue
              const status = statusByName[`${entry.type}:${entry.name}`]
              if (status?.[scope] !== "installed") continue
              const result = yield* Effect.promise(() =>
                installOne({ entry, catalog, scope, homeDir, projectRoot, git }),
              )
              outcomes.push({
                name: entry.name,
                type: entry.type,
                scope,
                ok: result.ok,
                ...(result.ok ? {} : { error: result.message ?? result.error }),
              })
            }
          }
          return { outcomes }
        }),
    }
  }),
)

export const LibraryRepoTest = (
  fixtures: {
    readonly catalog?: CatalogBundle
    readonly agentic?: Partial<Record<LibraryCategory, AgenticListing>>
    readonly installEntry?: LibraryServiceApi["installEntry"]
    readonly addEntry?: LibraryServiceApi["addEntry"]
    readonly pushEntry?: LibraryServiceApi["pushEntry"]
    readonly removeEntry?: LibraryServiceApi["removeEntry"]
    readonly syncAll?: LibraryServiceApi["syncAll"]
    readonly initLibrary?: LibraryServiceApi["initLibrary"]
  } = {},
): Layer.Layer<LibraryService> =>
  Layer.succeed(LibraryService, {
    initLibrary:
      fixtures.initLibrary ?? (() => Effect.succeed({ catalogPath: "/stub/library.yaml" })),
    readCatalog: () =>
      fixtures.catalog
        ? Effect.succeed(fixtures.catalog)
        : Effect.fail<LibraryError>("catalog_not_found"),
    listAgenticRepo: (category) => {
      const a = fixtures.agentic?.[category]
      return a ? Effect.succeed(a) : Effect.fail<LibraryError>("agentic_repo_missing")
    },
    installEntry:
      fixtures.installEntry ??
      ((input) =>
        Effect.succeed({ installed: [input.name], destinations: [`/stub/${input.name}`] })),
    addEntry:
      fixtures.addEntry ??
      ((input) =>
        Effect.succeed({
          name: input.name,
          type: input.type,
          description: input.description,
          source: input.source,
          ...(input.requires && input.requires.length > 0 ? { requires: input.requires } : {}),
        })),
    pushEntry: fixtures.pushEntry ?? (() => Effect.succeed({ commitSha: "stub-sha" })),
    removeEntry: fixtures.removeEntry ?? (() => Effect.succeed(undefined)),
    syncAll: fixtures.syncAll ?? (() => Effect.succeed({ outcomes: [] })),
  })
