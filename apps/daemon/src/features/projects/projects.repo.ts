import { readFile, readdir, stat } from "node:fs/promises"
import { join } from "node:path"
import { Context, Effect, Layer } from "effect"
import { ConfigService } from "../../platform/config.repo"
import {
  type FileEntry,
  looksBinary,
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
  readonly branch?: string
  readonly githubUrl?: string
  readonly githubOwner?: string
  readonly githubRepo?: string
}

export type FileListing = {
  readonly path: string
  readonly entries: readonly FileEntry[]
}

export type FileContent = {
  readonly path: string
  readonly size: number
  readonly isBinary: boolean
  readonly truncated: boolean
  readonly content: string
}

export type FileError = "not_found" | "not_a_directory" | "not_a_file" | "forbidden" | "too_large"

const MAX_READ_BYTES = 1_000_000 // 1 MB hard cap on previews

export type ProjectsServiceApi = {
  readonly list: () => Effect.Effect<readonly Project[], never, never>
  readonly listDir: (
    id: string,
    relPath: string | undefined,
  ) => Effect.Effect<FileListing, FileError, never>
  readonly readFile: (id: string, relPath: string) => Effect.Effect<FileContent, FileError, never>
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
    return {
      id: entry,
      name: entry,
      path,
      isGitRepo,
      lastModified: s.mtimeMs,
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
          projects.sort((a, b) => b.lastModified - a.lastModified)
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

      readFile: (id, relPath) =>
        Effect.gen(function* () {
          const root = findProjectPath(config.projectsRoot, id)
          if (!root) return yield* Effect.fail<FileError>("not_found")
          const resolved = resolveProjectPath(root, relPath)
          if (!resolved.ok) return yield* Effect.fail<FileError>("forbidden")
          const s = yield* Effect.tryPromise(() => stat(resolved.absPath)).pipe(
            Effect.mapError<unknown, FileError>(() => "not_found"),
          )
          if (!s.isFile()) return yield* Effect.fail<FileError>("not_a_file")
          if (s.size > MAX_READ_BYTES) return yield* Effect.fail<FileError>("too_large")
          const bytes = yield* Effect.tryPromise(() => readFile(resolved.absPath)).pipe(
            Effect.mapError<unknown, FileError>(() => "not_found"),
          )
          const data = bytes as unknown as Uint8Array
          const isBinary = looksBinary(data)
          return {
            path: resolved.relPath,
            size: s.size,
            isBinary,
            truncated: false,
            content: isBinary ? "" : new TextDecoder("utf-8", { fatal: false }).decode(data),
          }
        }),
    }
  }),
)

export const ProjectsRepoTest = (fixtures: readonly Project[]): Layer.Layer<ProjectsService> =>
  Layer.succeed(ProjectsService, {
    list: () => Effect.succeed([...fixtures].sort((a, b) => b.lastModified - a.lastModified)),
    listDir: () => Effect.fail<FileError>("not_found"),
    readFile: () => Effect.fail<FileError>("not_found"),
  })
