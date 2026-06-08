import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { clampLimit, gitLog, gitStatus } from "./git.repo"

const git = async (cwd: string, args: string[]): Promise<void> => {
  const proc = Bun.spawn({ cmd: ["git", "-C", cwd, ...args], stdout: "ignore", stderr: "ignore" })
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

describe("clampLimit", () => {
  it("defaults when absent and clamps to bounds", () => {
    expect(clampLimit(undefined)).toBe(20)
    expect(clampLimit(0)).toBe(1)
    expect(clampLimit(5)).toBe(5)
    expect(clampLimit(9999)).toBe(200)
    expect(clampLimit(Number.NaN)).toBe(20)
  })
})
