import { Context, Data, Effect, Layer } from "effect"
import {
  type FileChange,
  MAX_DIFF_BYTES,
  mergeChanges,
  parseNameStatus,
  parseUntracked,
  truncateDiff,
} from "./files.core"

export class FilesError extends Data.TaggedError("FilesError")<{
  readonly reason: "not_a_worktree" | "git_failed" | "no_base_ref" | "spawn_failed"
  readonly stderr?: string
}> {}

export type WorktreeDiff = {
  readonly worktreePath: string
  readonly base: string
  readonly files: readonly FileChange[]
  readonly diff: string
  readonly truncated: boolean
  readonly changed: boolean
}

export type FilesServiceApi = {
  readonly diffWorktree: (worktreePath: string) => Effect.Effect<WorktreeDiff, FilesError>
}

export class FilesService extends Context.Tag("FilesService")<FilesService, FilesServiceApi>() {}

export type GitOutput = { readonly stdout: string; readonly stderr: string; readonly code: number }
export type GitRunner = (args: readonly string[], cwd: string) => Promise<GitOutput>

// The default runner shells out to `git`. Tests substitute a fake via
// `makeFilesService` so they don't depend on a real worktree.
const defaultGitRunner: GitRunner = async (args, cwd) => {
  const proc = Bun.spawn({
    cmd: ["git", ...args],
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  })
  const decoder = new TextDecoder()
  const drain = async (s: ReadableStream<Uint8Array> | null): Promise<string> => {
    if (!s) return ""
    const reader = s.getReader()
    const chunks: Uint8Array[] = []
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      if (value) chunks.push(value)
    }
    let total = 0
    for (const c of chunks) total += c.byteLength
    const merged = new Uint8Array(total)
    let off = 0
    for (const c of chunks) {
      merged.set(c, off)
      off += c.byteLength
    }
    return decoder.decode(merged)
  }
  const [stdout, stderr] = await Promise.all([drain(proc.stdout), drain(proc.stderr)])
  const code = await proc.exited
  return { stdout, stderr, code }
}

// Pick a base ref that exists in the worktree. We mirror the worktree workflow
// described in AGENTS.md: branches are cut from origin/main, so that's our
// preferred diff target. Fallbacks let the diff still render for unusual repos.
const BASE_CANDIDATES = ["origin/main", "origin/master", "main", "master", "HEAD"] as const

const verifyRef = ({
  git,
  cwd,
  ref,
}: {
  git: GitRunner
  cwd: string
  ref: string
}): Effect.Effect<boolean, FilesError> =>
  Effect.tryPromise({
    try: async () => {
      const { code } = await git(["rev-parse", "--verify", "--quiet", ref], cwd)
      return code === 0
    },
    catch: () => new FilesError({ reason: "spawn_failed" }),
  })

const pickBase = (git: GitRunner, cwd: string): Effect.Effect<string, FilesError> =>
  Effect.gen(function* () {
    for (const ref of BASE_CANDIDATES) {
      const ok = yield* verifyRef({ git, cwd, ref })
      if (ok) return ref
    }
    return yield* Effect.fail(new FilesError({ reason: "no_base_ref" }))
  })

const runGit = ({
  git,
  args,
  cwd,
}: {
  git: GitRunner
  args: readonly string[]
  cwd: string
}): Effect.Effect<GitOutput, FilesError> =>
  Effect.tryPromise({
    try: () => git(args, cwd),
    catch: () => new FilesError({ reason: "spawn_failed" }),
  })

const computeDiff = (
  git: GitRunner,
  worktreePath: string,
): Effect.Effect<WorktreeDiff, FilesError> =>
  Effect.gen(function* () {
    // Reject paths that aren't actually a git worktree before invoking diff.
    const insideRes = yield* runGit({
      git,
      args: ["rev-parse", "--is-inside-work-tree"],
      cwd: worktreePath,
    })
    if (insideRes.code !== 0 || insideRes.stdout.trim() !== "true") {
      return yield* Effect.fail(new FilesError({ reason: "not_a_worktree" }))
    }

    const base = yield* pickBase(git, worktreePath)
    // Use the merge-base so the diff captures committed-to-branch changes
    // PLUS uncommitted/working-tree edits, while ignoring commits the user
    // hasn't authored (e.g. unrelated main movement). `git diff <commit>`
    // already includes the working tree.
    const nameStatusOut = yield* runGit({
      git,
      args: ["diff", "--name-status", "-z", base],
      cwd: worktreePath,
    })
    if (nameStatusOut.code !== 0) {
      return yield* Effect.fail(
        new FilesError({ reason: "git_failed", stderr: nameStatusOut.stderr }),
      )
    }
    const tracked = parseNameStatus(nameStatusOut.stdout)

    const untrackedOut = yield* runGit({
      git,
      args: ["ls-files", "--others", "--exclude-standard", "-z"],
      cwd: worktreePath,
    })
    const untracked = untrackedOut.code === 0 ? parseUntracked(untrackedOut.stdout) : []
    const files = mergeChanges(tracked, untracked)

    const diffOut = yield* runGit({ git, args: ["diff", base], cwd: worktreePath })
    const truncatedDiff =
      diffOut.code === 0
        ? truncateDiff(diffOut.stdout, MAX_DIFF_BYTES)
        : { diff: "", truncated: false }

    return {
      worktreePath,
      base,
      files,
      diff: truncatedDiff.diff,
      truncated: truncatedDiff.truncated,
      changed: files.length > 0 || truncatedDiff.diff.length > 0,
    }
  })

export const makeFilesService = (gitRunner: GitRunner): FilesServiceApi => ({
  diffWorktree: (worktreePath) => computeDiff(gitRunner, worktreePath),
})

export const FilesRepoLive: Layer.Layer<FilesService> = Layer.succeed(
  FilesService,
  makeFilesService(defaultGitRunner),
)
