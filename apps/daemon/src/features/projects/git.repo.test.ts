import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { clampLimit, gitLog, gitPull, gitStatus } from "./git.repo"

// Scrub GIT_* so fixture setup builds the temp repo even when the test itself
// runs inside a git hook (which exports GIT_DIR/GIT_WORK_TREE).
const cleanEnv = (): Record<string, string> => {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && !k.startsWith("GIT_")) env[k] = v
  }
  return env
}

const git = async (cwd: string, args: string[]): Promise<void> => {
  const proc = Bun.spawn({
    cmd: ["git", "-C", cwd, ...args],
    stdout: "ignore",
    stderr: "ignore",
    env: cleanEnv(),
  })
  await proc.exited
}

let repo: string
let notRepo: string

beforeAll(async () => {
  repo = await mkdtemp(join(tmpdir(), "pid-git-"))
  notRepo = await mkdtemp(join(tmpdir(), "pid-nogit-"))
  await git(repo, ["init", "-b", "main"])
  await git(repo, ["config", "user.email", "t@example.com"])
  await git(repo, ["config", "user.name", "Tester"])
  await writeFile(join(repo, "a.txt"), "hello\n")
  await git(repo, ["add", "a.txt"])
  await git(repo, ["commit", "-m", "initial commit"])
  // Leave a dirty worktree: one modified tracked file + one untracked file.
  await writeFile(join(repo, "a.txt"), "hello world\n")
  await writeFile(join(repo, "b.txt"), "new\n")
})

afterAll(async () => {
  await rm(repo, { recursive: true, force: true })
  await rm(notRepo, { recursive: true, force: true })
})

describe("gitStatus", () => {
  it("returns the branch and dirty entries for a real repo", async () => {
    const res = await gitStatus(repo)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.value.branch).toBe("main")
    const paths = res.value.entries.map((e) => e.path).sort()
    expect(paths).toEqual(["a.txt", "b.txt"])
  })

  it("reports not_a_repo outside a git repository", async () => {
    const res = await gitStatus(notRepo)
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error).toBe("not_a_repo")
  })

  it("ignores an ambient GIT_DIR and reads the repo at the given path", async () => {
    // Simulate running inside a git hook, which exports GIT_DIR for the OUTER
    // repo. The scoped API must still report the repo at repoPath, not GIT_DIR.
    const prev = process.env.GIT_DIR
    process.env.GIT_DIR = join(notRepo, "nonexistent.git")
    try {
      const res = await gitStatus(repo)
      expect(res.ok).toBe(true)
      if (!res.ok) return
      expect(res.value.branch).toBe("main")
    } finally {
      if (prev === undefined) delete process.env.GIT_DIR
      else process.env.GIT_DIR = prev
    }
  })

  it("does not walk up into an enclosing repo for a non-repo subdir", async () => {
    // repo/sub has no .git of its own; we must NOT report repo's status.
    const sub = join(repo, "sub")
    await mkdir(sub, { recursive: true })
    const res = await gitStatus(sub)
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error).toBe("not_a_repo")
  })
})

describe("gitLog", () => {
  it("returns commits newest-first with parsed fields", async () => {
    const res = await gitLog(repo, 10)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.value.length).toBe(1)
    const first = res.value[0]
    expect(first).toBeDefined()
    if (!first) return
    expect(first.subject).toBe("initial commit")
    expect(first.author).toBe("Tester")
    expect(first.hash.length).toBeGreaterThan(0)
  })

  it("reports not_a_repo outside a git repository", async () => {
    const res = await gitLog(notRepo)
    expect(res.ok).toBe(false)
  })
})

describe("gitPull", () => {
  it("fast-forwards a clone behind its origin", async () => {
    // origin (bare) ← upstream (commits) ; clone pulls upstream's new commit.
    const origin = await mkdtemp(join(tmpdir(), "pid-origin-"))
    const upstream = await mkdtemp(join(tmpdir(), "pid-up-"))
    const clone = await mkdtemp(join(tmpdir(), "pid-clone-"))
    try {
      await git(origin, ["init", "--bare", "-b", "main"])
      await git(upstream, ["clone", origin, "."])
      await git(upstream, ["config", "user.email", "t@example.com"])
      await git(upstream, ["config", "user.name", "Tester"])
      await writeFile(join(upstream, "x.txt"), "one\n")
      await git(upstream, ["add", "x.txt"])
      await git(upstream, ["commit", "-m", "first"])
      await git(upstream, ["push", "origin", "main"])
      await git(clone, ["clone", origin, "."])
      // Advance origin via upstream so the clone is one commit behind.
      await writeFile(join(upstream, "x.txt"), "two\n")
      await git(upstream, ["commit", "-am", "second"])
      await git(upstream, ["push", "origin", "main"])

      const res = await gitPull(clone)
      expect(res.ok).toBe(true)
      if (!res.ok) return
      expect(res.value.alreadyUpToDate).toBe(false)
    } finally {
      await rm(origin, { recursive: true, force: true })
      await rm(upstream, { recursive: true, force: true })
      await rm(clone, { recursive: true, force: true })
    }
  })

  it("reports already up to date when there is nothing to pull", async () => {
    const origin = await mkdtemp(join(tmpdir(), "pid-origin-"))
    const clone = await mkdtemp(join(tmpdir(), "pid-clone-"))
    try {
      await git(origin, ["init", "--bare", "-b", "main"])
      await git(clone, ["clone", origin, "."])
      await git(clone, ["config", "user.email", "t@example.com"])
      await git(clone, ["config", "user.name", "Tester"])
      await writeFile(join(clone, "x.txt"), "one\n")
      await git(clone, ["add", "x.txt"])
      await git(clone, ["commit", "-m", "first"])
      await git(clone, ["push", "origin", "main"])

      const res = await gitPull(clone)
      expect(res.ok).toBe(true)
      if (!res.ok) return
      expect(res.value.alreadyUpToDate).toBe(true)
    } finally {
      await rm(origin, { recursive: true, force: true })
      await rm(clone, { recursive: true, force: true })
    }
  })

  it("reports not_a_repo outside a git repository", async () => {
    const res = await gitPull(notRepo)
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error).toBe("not_a_repo")
  })
})

describe("clampLimit", () => {
  it("defaults when absent and clamps to bounds", () => {
    expect(clampLimit(undefined)).toBe(20)
    expect(clampLimit(0)).toBe(1)
    expect(clampLimit(5)).toBe(5)
    expect(clampLimit(9999)).toBe(200)
    expect(clampLimit(Number.NaN)).toBe(20)
  })
})
