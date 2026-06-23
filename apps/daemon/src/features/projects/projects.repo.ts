import { readdir, readFile, stat } from "node:fs/promises"
import { join } from "node:path"
import { Context, Effect, Layer } from "effect"
import { ConfigService } from "../../platform/config.repo"
import { readFileAt, resolveRawAt, treeAt } from "./fileBrowser.repo"
import {
  compareProjectsByCommit,
  type FileEntry,
  parseGitCommitTimestamp,
  parseGitHead,
  parseGithubOrigin,
  resolveProjectPath,
  sortEntries,
} from "./projects.core"

export type Project = {
  readonly id: string
  readonly name: string
  readonly path: string
  readonly isGitRepo: boolean
  readonly lastModified: number
  readonly lastCommitMs?: number
  readonly branch?: string
  readonly githubUrl?: string
  readonly githubOwner?: string
  readonly githubRepo?: string
}

type FileListing = {
  readonly path: string
  readonly entries: readonly FileEntry[]
}

type FileTreeListing = {
  // Flat, posix-relative list of every file path under the project root
  // (directories are implied by the path segments). Feeds @pierre/trees, which
  // builds and virtualises the tree from this list.
  readonly paths: readonly string[]
  readonly truncated: boolean
}

type FileContent = {
  readonly path: string
  readonly size: number
  readonly isBinary: boolean
  readonly truncated: boolean
  readonly content: string
}

export type FileError = "not_found" | "not_a_directory" | "not_a_file" | "forbidden" | "too_large"

type RawFile = {
  readonly absPath: string
  readonly relPath: string
  readonly size: number
  readonly mime: string
}

type ProjectsServiceApi = {
  readonly list: () => Effect.Effect<readonly Project[], never, never>
  readonly listDir: (
    id: string,
    relPath: string | undefined,
  ) => Effect.Effect<FileListing, FileError, never>
  readonly listTree: (id: string) => Effect.Effect<FileTreeListing, FileError, never>
  readonly readFile: (id: string, relPath: string) => Effect.Effect<FileContent, FileError, never>
  readonly resolveRaw: (id: string, relPath: string) => Effect.Effect<RawFile, FileError, never>
}

export class ProjectsService extends Context.Tag("ProjectsService")<
  ProjectsService,
  ProjectsServiceApi
>() {}

const readBranch = async (gitHeadPath: string): Promise<string | null> => {
  try {
    const text = await readFile(gitHeadPath, "utf8")
    return parseGitHead(text)
  } catch {
    return null
  }
}

// Runs `git log -1 --format=%ct HEAD` against the repo and returns the HEAD
// commit time in ms, or null if the command fails (no commits yet, git missing,
// timeout). Times out fast so a slow repo can't stall the project list.
const readLastCommitMs = async (repoPath: string): Promise<number | null> => {
  try {
    const proc = Bun.spawn({
      cmd: ["git", "-C", repoPath, "log", "-1", "--format=%ct", "HEAD"],
      stdout: "pipe",
      stderr: "ignore",
      stdin: "ignore",
    })
    const timer = setTimeout(() => {
      try {
        proc.kill()
      } catch {
        // ignore — already exited
      }
    }, 2_000)
    const stdout = await new Response(proc.stdout).text()
    const exitCode = await proc.exited
    clearTimeout(timer)
    if (exitCode !== 0) return null
    return parseGitCommitTimestamp(stdout)
  } catch {
    return null
  }
}

const probeProject = (
  projectsRoot: string,
  entry: string,
): Effect.Effect<Project | null, never, never> =>
  Effect.tryPromise(async () => {
    if (entry.startsWith(".")) return null
    const path = join(projectsRoot, entry)
    const s = await stat(path)
    if (!s.isDirectory()) return null
    let isGitRepo = false
    let gitConfigPath: string | null = null
    let gitHeadPath: string | null = null
    try {
      const gs = await stat(join(path, ".git"))
      if (gs.isDirectory()) {
        isGitRepo = true
        gitConfigPath = join(path, ".git", "config")
        gitHeadPath = join(path, ".git", "HEAD")
      } else if (gs.isFile()) {
        isGitRepo = true
        // Worktree/submodule .git file — skip config probe (origin lives in
        // the parent repo; we don't traverse `gitdir:` references here).
      }
    } catch {
      isGitRepo = false
    }
    let gh: ReturnType<typeof parseGithubOrigin> = null
    if (gitConfigPath) {
      try {
        const text = await readFile(gitConfigPath, "utf8")
        gh = parseGithubOrigin(text)
      } catch {
        gh = null
      }
    }
    const branch = gitHeadPath ? await readBranch(gitHeadPath) : null
    const lastCommitMs = isGitRepo ? await readLastCommitMs(path) : null
    return {
      id: entry,
      name: entry,
      path,
      isGitRepo,
      lastModified: s.mtimeMs,
      ...(lastCommitMs !== null ? { lastCommitMs } : {}),
      ...(branch ? { branch } : {}),
      ...(gh ? { githubUrl: gh.url, githubOwner: gh.owner, githubRepo: gh.repo } : {}),
    }
  }).pipe(Effect.orElseSucceed(() => null))

const findProjectPath = (projectsRoot: string, id: string): string | null => {
  if (id.startsWith(".") || id.includes("/") || id.includes("\\") || id.includes("\0")) return null
  return join(projectsRoot, id)
}

const classifyEntry = async (parentAbs: string, name: string): Promise<FileEntry | null> => {
  try {
    const s = await stat(join(parentAbs, name))
    if (s.isDirectory()) return { name, type: "dir", size: 0 }
    if (s.isFile()) return { name, type: "file", size: s.size }
    if (s.isSymbolicLink()) return { name, type: "symlink", size: s.size }
    return { name, type: "other", size: s.size }
  } catch {
    return null
  }
}

export const ProjectsRepoLive: Layer.Layer<ProjectsService, never, ConfigService> = Layer.effect(
  ProjectsService,
  Effect.gen(function* () {
    const cfg = yield* ConfigService
    const config = yield* cfg.get()
    return {
      list: () =>
        Effect.gen(function* () {
          const entries = yield* Effect.tryPromise(() => readdir(config.projectsRoot)).pipe(
            Effect.orElseSucceed(() => [] as readonly string[]),
          )
          const probed = yield* Effect.all(
            entries.map((e) => probeProject(config.projectsRoot, e)),
            { concurrency: 8 },
          )
          const projects = probed.filter((p): p is Project => p !== null)
          projects.sort(compareProjectsByCommit)
          return projects
        }),

      listDir: (id, relPath) =>
        Effect.gen(function* () {
          const root = findProjectPath(config.projectsRoot, id)
          if (!root) return yield* Effect.fail<FileError>("not_found")
          const resolved = resolveProjectPath(root, relPath)
          if (!resolved.ok) return yield* Effect.fail<FileError>("forbidden")
          const s = yield* Effect.tryPromise(() => stat(resolved.absPath)).pipe(
            Effect.mapError<unknown, FileError>(() => "not_found"),
          )
          if (!s.isDirectory()) return yield* Effect.fail<FileError>("not_a_directory")
          const names = yield* Effect.tryPromise(() => readdir(resolved.absPath)).pipe(
            Effect.mapError<unknown, FileError>(() => "not_found"),
          )
          const probed = yield* Effect.tryPromise(() =>
            Promise.all(names.map((n) => classifyEntry(resolved.absPath, n))),
          ).pipe(Effect.orElseSucceed((): (FileEntry | null)[] => []))
          const kept: FileEntry[] = []
          for (const e of probed) {
            if (e !== null) kept.push(e)
          }
          const entries = sortEntries(kept)
          return { path: resolved.relPath, entries }
        }),

      listTree: (id) =>
        Effect.gen(function* () {
          const root = findProjectPath(config.projectsRoot, id)
          if (!root) return yield* Effect.fail<FileError>("not_found")
          const res = yield* Effect.promise(() => treeAt(root))
          if (!res.ok) return yield* Effect.fail<FileError>(res.error)
          return res.value
        }),

      readFile: (id, relPath) =>
        Effect.gen(function* () {
          const root = findProjectPath(config.projectsRoot, id)
          if (!root) return yield* Effect.fail<FileError>("not_found")
          const res = yield* Effect.promise(() => readFileAt(root, relPath))
          if (!res.ok) return yield* Effect.fail<FileError>(res.error)
          return res.value
        }),

      resolveRaw: (id, relPath) =>
        Effect.gen(function* () {
          const root = findProjectPath(config.projectsRoot, id)
          if (!root) return yield* Effect.fail<FileError>("not_found")
          const res = yield* Effect.promise(() => resolveRawAt(root, relPath))
          if (!res.ok) return yield* Effect.fail<FileError>(res.error)
          return res.value
        }),
    }
  }),
)

export const ProjectsRepoTest = (fixtures: readonly Project[]): Layer.Layer<ProjectsService> =>
  Layer.succeed(ProjectsService, {
    list: () => Effect.succeed([...fixtures].sort(compareProjectsByCommit)),
    listDir: () => Effect.fail<FileError>("not_found"),
    listTree: () => Effect.fail<FileError>("not_found"),
    readFile: () => Effect.fail<FileError>("not_found"),
    resolveRaw: () => Effect.fail<FileError>("not_found"),
  })
