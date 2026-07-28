// Side-effect helpers for installing / pushing library entries: filesystem
// copy + an injectable `GitClient` for git operations. The repo layer
// composes these.
//
// Filesystem ops use `node:fs/promises` directly. Tests can run them against
// tmp dirs cheaply.
// Git ops route through `GitClient` so unit tests can stub network/auth.

import { cp, mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Context, Data, Effect, Layer } from "effect"

export class GitError extends Data.TaggedError("GitError")<{
  readonly message: string
  readonly stderr?: string
}> {}

export type GitClientApi = {
  readonly clone: ({
    url,
    dst,
    opts,
  }: {
    url: string
    dst: string
    opts?: { branch?: string; depth?: number }
  }) => Effect.Effect<void, GitError, never>
  readonly pullFastForward: (dir: string) => Effect.Effect<void, GitError, never>
  readonly commitAndPush: ({
    dir,
    files,
    message,
  }: {
    dir: string
    files: readonly string[]
    message: string
  }) => Effect.Effect<string, GitError, never>
}

export class GitClient extends Context.Tag("GitClient")<GitClient, GitClientApi>() {}

const runGit = ({
  cwd,
  args,
  timeoutMs = 60_000,
}: {
  cwd: string | null
  args: readonly string[]
  timeoutMs?: number
}) =>
  Effect.tryPromise({
    try: async () => {
      const proc = Bun.spawn({
        cmd: ["git", ...args],
        cwd: cwd ?? undefined,
        stdout: "pipe",
        stderr: "pipe",
        stdin: "ignore",
      })
      const timer = setTimeout(() => {
        try {
          proc.kill()
        } catch {
          // already exited
        }
      }, timeoutMs)
      const [stdout, stderr] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ])
      const exitCode = await proc.exited
      clearTimeout(timer)
      if (exitCode !== 0) {
        throw new GitError({
          message: `git ${args.join(" ")} exited ${exitCode}`,
          stderr: stderr.trim(),
        })
      }
      return stdout.trim()
    },
    catch: (cause) =>
      cause instanceof GitError
        ? cause
        : new GitError({ message: `git ${args.join(" ")} failed: ${String(cause)}` }),
  })

export const GitClientLive: Layer.Layer<GitClient> = Layer.succeed(GitClient, {
  clone: ({ url, dst, opts }) =>
    Effect.gen(function* () {
      const args = ["clone"]
      if (opts?.depth !== undefined) args.push("--depth", String(opts.depth))
      if (opts?.branch) args.push("-b", opts.branch)
      args.push(url, dst)
      yield* runGit({ cwd: null, args }).pipe(Effect.asVoid)
    }),
  pullFastForward: (dir) => runGit({ cwd: dir, args: ["pull", "--ff-only"] }).pipe(Effect.asVoid),
  commitAndPush: ({ dir, files, message }) =>
    Effect.gen(function* () {
      // Stage only the requested files so unrelated dirty state isn't swept up.
      yield* runGit({ cwd: dir, args: ["add", "--", ...files] })
      // `commit --allow-empty=never` keeps us honest if nothing actually changed.
      const status = yield* runGit({ cwd: dir, args: ["status", "--porcelain", "--", ...files] })
      if (status === "") {
        return ""
      }
      yield* runGit({ cwd: dir, args: ["commit", "-m", message] })
      const sha = yield* runGit({ cwd: dir, args: ["rev-parse", "HEAD"] })
      yield* runGit({ cwd: dir, args: ["push"] })
      return sha
    }),
})

// In-memory recorder for tests. Each method records the call; `clone` makes
// the destination directory exist so subsequent `cp` operations work, and
// optionally writes a "skill bundle" so test scenarios feel realistic.
export type GitClientRecorder = {
  readonly client: GitClientApi
  readonly calls: ReadonlyArray<{ method: string; args: readonly unknown[] }>
}

export const makeGitClientRecorder = (opts?: {
  readonly cloneContents?: (dst: string) => Promise<void>
  readonly failClone?: boolean
  readonly failPush?: boolean
}): GitClientRecorder => {
  const calls: { method: string; args: readonly unknown[] }[] = []
  return {
    client: {
      clone: ({ url, dst, opts: options }) =>
        Effect.gen(function* () {
          calls.push({ method: "clone", args: [url, dst, options] })
          if (opts?.failClone) {
            return yield* Effect.fail(new GitError({ message: "clone failed (stub)" }))
          }
          yield* Effect.promise(() => mkdir(dst, { recursive: true }))
          if (opts?.cloneContents) {
            yield* Effect.promise(() => opts.cloneContents?.(dst) ?? Promise.resolve())
          }
        }),
      pullFastForward: (dir) =>
        Effect.sync(() => {
          calls.push({ method: "pullFastForward", args: [dir] })
        }),
      commitAndPush: ({ dir, files, message }) =>
        Effect.gen(function* () {
          calls.push({ method: "commitAndPush", args: [dir, files, message] })
          if (opts?.failPush) {
            return yield* Effect.fail(new GitError({ message: "push failed (stub)" }))
          }
          return "stub-sha"
        }),
    },
    calls,
  }
}

export const GitClientTestLayer = (recorder: GitClientRecorder): Layer.Layer<GitClient> =>
  Layer.succeed(GitClient, recorder.client)

// --- Filesystem helpers --------------------------------------------------------

// Replace-style copy: remove `dst` first so the install mirrors `src` exactly
// (no stale files left behind from a previous version). Then recreate parent
// and copy.
export const copyDir = async (src: string, dst: string): Promise<void> => {
  await rm(dst, { recursive: true, force: true })
  // Ensure the parent of `dst` exists, then copy `src` to `dst`.
  const parent = dst.includes("/") ? dst.slice(0, dst.lastIndexOf("/")) : "."
  await mkdir(parent, { recursive: true })
  await cp(src, dst, { recursive: true, force: true, dereference: false })
}

// Safe `rm -rf <dir>`. No-ops if the path doesn't exist.
export const removeDir = async (dir: string): Promise<void> => {
  await rm(dir, { recursive: true, force: true })
}

// Returns a tmp dir path that the caller is responsible for cleaning up.
// Pair with `using` once we adopt Disposable, or call removeDir() manually.
export const makeTempDir = async (prefix: string): Promise<string> =>
  mkdtemp(join(tmpdir(), `${prefix}-`))
