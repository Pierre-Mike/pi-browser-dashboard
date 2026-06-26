import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { FilesError, type GitOutput, type GitRunner, makeFilesService } from "./files.repo"

const ok = (stdout: string): GitOutput => ({ stdout, stderr: "", code: 0 })
const fail = (stderr: string): GitOutput => ({ stdout: "", stderr, code: 128 })

type Call = { readonly args: readonly string[]; readonly cwd: string }

const makeRunner = (
  responses: ReadonlyArray<(args: readonly string[]) => GitOutput | null>,
): { runner: GitRunner; calls: readonly Call[] } => {
  const calls: Call[] = []
  const runner: GitRunner = async (args, cwd) => {
    calls.push({ args, cwd })
    for (const handler of responses) {
      const out = handler(args)
      if (out) return out
    }
    return fail(`unhandled: git ${args.join(" ")}`)
  }
  return { runner, calls }
}

const argsMatch = (args: readonly string[], pattern: readonly string[]): boolean =>
  args.length === pattern.length && args.every((a, i) => a === pattern[i])

describe("FilesService.diffWorktree", () => {
  test("returns changed=false when worktree has no diffs against the base", async () => {
    const { runner } = makeRunner([
      (a) => (argsMatch(a, ["rev-parse", "--is-inside-work-tree"]) ? ok("true\n") : null),
      (a) =>
        argsMatch(a, ["rev-parse", "--verify", "--quiet", "origin/main"]) ? ok("ref\n") : null,
      (a) => (argsMatch(a, ["diff", "--name-status", "-z", "origin/main"]) ? ok("") : null),
      (a) => (argsMatch(a, ["ls-files", "--others", "--exclude-standard", "-z"]) ? ok("") : null),
      (a) => (argsMatch(a, ["diff", "origin/main"]) ? ok("") : null),
    ])
    const svc = makeFilesService(runner)
    const out = await Effect.runPromise(svc.diffWorktree("/wt"))
    expect(out).toEqual({
      worktreePath: "/wt",
      base: "origin/main",
      files: [],
      diff: "",
      truncated: false,
      changed: false,
    })
  })

  test("uses the configured base candidates (global git settings) over the default", async () => {
    // A repo whose default branch is `develop` on remote `upstream`: only that
    // ref verifies. The default candidate list (origin/main, …) would never
    // match, so a green diff proves the configured candidates flow through.
    const { runner } = makeRunner([
      (a) => (argsMatch(a, ["rev-parse", "--is-inside-work-tree"]) ? ok("true\n") : null),
      (a) =>
        argsMatch(a, ["rev-parse", "--verify", "--quiet", "upstream/develop"]) ? ok("ref\n") : null,
      (a) => (argsMatch(a, ["diff", "--name-status", "-z", "upstream/develop"]) ? ok("") : null),
      (a) => (argsMatch(a, ["ls-files", "--others", "--exclude-standard", "-z"]) ? ok("") : null),
      (a) => (argsMatch(a, ["diff", "upstream/develop"]) ? ok("") : null),
    ])
    const svc = makeFilesService(runner, ["upstream/develop", "HEAD"])
    const out = await Effect.runPromise(svc.diffWorktree("/wt"))
    expect(out.base).toBe("upstream/develop")
    expect(out.changed).toBe(false)
  })

  test("collects tracked changes, untracked files, and the unified diff", async () => {
    const { runner } = makeRunner([
      (a) => (argsMatch(a, ["rev-parse", "--is-inside-work-tree"]) ? ok("true\n") : null),
      (a) =>
        argsMatch(a, ["rev-parse", "--verify", "--quiet", "origin/main"]) ? ok("ref\n") : null,
      (a) =>
        argsMatch(a, ["diff", "--name-status", "-z", "origin/main"])
          ? ok("M\0apps/foo.ts\0A\0apps/bar.ts\0")
          : null,
      (a) =>
        argsMatch(a, ["ls-files", "--others", "--exclude-standard", "-z"])
          ? ok("docs/notes.md\0")
          : null,
      (a) =>
        argsMatch(a, ["diff", "origin/main"])
          ? ok("diff --git a/apps/foo.ts b/apps/foo.ts\n@@ ... @@\n")
          : null,
    ])
    const svc = makeFilesService(runner)
    const out = await Effect.runPromise(svc.diffWorktree("/wt"))
    expect(out.changed).toBe(true)
    expect(out.base).toBe("origin/main")
    expect(out.files.map((f) => f.path)).toEqual(["apps/bar.ts", "apps/foo.ts", "docs/notes.md"])
    expect(out.files.find((f) => f.path === "docs/notes.md")?.status).toBe("untracked")
    expect(out.diff).toContain("diff --git")
    expect(out.truncated).toBe(false)
  })

  test("falls back from origin/main to the next available ref", async () => {
    const { runner, calls } = makeRunner([
      (a) => (argsMatch(a, ["rev-parse", "--is-inside-work-tree"]) ? ok("true\n") : null),
      (a) =>
        argsMatch(a, ["rev-parse", "--verify", "--quiet", "origin/main"]) ? fail("missing") : null,
      (a) =>
        argsMatch(a, ["rev-parse", "--verify", "--quiet", "origin/master"])
          ? fail("missing")
          : null,
      (a) => (argsMatch(a, ["rev-parse", "--verify", "--quiet", "main"]) ? ok("ref\n") : null),
      (a) => (argsMatch(a, ["diff", "--name-status", "-z", "main"]) ? ok("M\0a.ts\0") : null),
      (a) => (argsMatch(a, ["ls-files", "--others", "--exclude-standard", "-z"]) ? ok("") : null),
      (a) => (argsMatch(a, ["diff", "main"]) ? ok("diff-body") : null),
    ])
    const svc = makeFilesService(runner)
    const out = await Effect.runPromise(svc.diffWorktree("/wt"))
    expect(out.base).toBe("main")
    expect(out.files).toHaveLength(1)
    const verifyCount = calls.filter(
      (c) => c.args[0] === "rev-parse" && c.args[1] === "--verify",
    ).length
    expect(verifyCount).toBe(3)
  })

  test("fails with not_a_worktree when the path isn't a git repo", async () => {
    const { runner } = makeRunner([
      (a) =>
        argsMatch(a, ["rev-parse", "--is-inside-work-tree"])
          ? { stdout: "", stderr: "fatal: not a git repo", code: 128 }
          : null,
    ])
    const svc = makeFilesService(runner)
    const exit = await Effect.runPromiseExit(svc.diffWorktree("/not-a-repo"))
    expect(exit._tag).toBe("Failure")
    if (exit._tag === "Failure") {
      const fa = exit.cause
      // shallow check via flattening to a fail value
      const failure = await Effect.runPromise(
        Effect.either(Effect.failCause(fa)).pipe(
          Effect.map((e) => (e._tag === "Left" ? e.left : null)),
        ),
      )
      expect(failure).toBeInstanceOf(FilesError)
      if (failure instanceof FilesError) expect(failure.reason).toBe("not_a_worktree")
    }
  })

  test("truncates very large diffs and flags the response", async () => {
    const big = "a".repeat(300_000)
    const { runner } = makeRunner([
      (a) => (argsMatch(a, ["rev-parse", "--is-inside-work-tree"]) ? ok("true\n") : null),
      (a) =>
        argsMatch(a, ["rev-parse", "--verify", "--quiet", "origin/main"]) ? ok("ref\n") : null,
      (a) =>
        argsMatch(a, ["diff", "--name-status", "-z", "origin/main"]) ? ok("M\0big.ts\0") : null,
      (a) => (argsMatch(a, ["ls-files", "--others", "--exclude-standard", "-z"]) ? ok("") : null),
      (a) => (argsMatch(a, ["diff", "origin/main"]) ? ok(big) : null),
    ])
    const svc = makeFilesService(runner)
    const out = await Effect.runPromise(svc.diffWorktree("/wt"))
    expect(out.truncated).toBe(true)
    expect(out.diff.length).toBe(200_000)
  })
})
