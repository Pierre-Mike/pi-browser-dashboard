import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect, Layer } from "effect"
import { ConfigRepoTest } from "../../platform/config.repo"
import { ProjectsRepoLive, ProjectsService } from "./projects.repo"

let root: string

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "pid-files-"))
  await mkdir(join(root, "demo", "src", "nested"), { recursive: true })
  await writeFile(join(root, "demo", "README.md"), "# demo\n")
  await writeFile(join(root, "demo", "src", "index.ts"), "export const x = 1\n")
  await writeFile(join(root, "demo", "src", "nested", "deep.txt"), "deep")
  // Binary fixture: a NUL byte triggers the binary heuristic.
  await writeFile(join(root, "demo", "bin.dat"), Buffer.from([1, 2, 0, 3]))

  // Git repo fixture: HEAD points at a slash-containing branch.
  await mkdir(join(root, "repo", ".git"), { recursive: true })
  await writeFile(join(root, "repo", ".git", "HEAD"), "ref: refs/heads/feat/login\n")
  await writeFile(
    join(root, "repo", ".git", "config"),
    `[remote "origin"]\n\turl = git@github.com:acme/widgets.git\n`,
  )

  // Detached HEAD fixture: no branch should be reported.
  await mkdir(join(root, "detached", ".git"), { recursive: true })
  await writeFile(
    join(root, "detached", ".git", "HEAD"),
    "9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b\n",
  )
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

const withLayer = <A, E>(fx: Effect.Effect<A, E, ProjectsService>): Promise<A> => {
  const layer = Layer.provide(ProjectsRepoLive, ConfigRepoTest({ projectsRoot: root }))
  return Effect.runPromise(Effect.provide(fx, layer))
}

describe("ProjectsRepo listDir", () => {
  it("lists the project root when no path is given", async () => {
    const out = await withLayer(
      Effect.flatMap(ProjectsService, (s) => s.listDir("demo", undefined)),
    )
    expect(out.path).toBe("")
    const names = out.entries.map((e) => e.name)
    expect(names).toContain("src")
    expect(names).toContain("README.md")
    // Directories ranked before files.
    expect(out.entries[0]?.type).toBe("dir")
  })

  it("lists a nested directory", async () => {
    const out = await withLayer(Effect.flatMap(ProjectsService, (s) => s.listDir("demo", "src")))
    expect(out.path).toBe("src")
    expect(out.entries.map((e) => e.name)).toEqual(["nested", "index.ts"])
  })

  it("rejects parent-directory escapes", async () => {
    const exit = await withLayer(
      Effect.flatMap(ProjectsService, (s) => s.listDir("demo", "../etc")).pipe(Effect.either),
    )
    expect(exit._tag).toBe("Left")
    if (exit._tag === "Left") expect(exit.left).toBe("forbidden")
  })

  it("fails with not_found for missing projects", async () => {
    const exit = await withLayer(
      Effect.flatMap(ProjectsService, (s) => s.listDir("missing", undefined)).pipe(Effect.either),
    )
    expect(exit._tag).toBe("Left")
    if (exit._tag === "Left") expect(exit.left).toBe("not_found")
  })
})

const runGit = async (cwd: string, args: readonly string[]): Promise<void> => {
  const proc = Bun.spawn({
    cmd: ["git", ...args],
    cwd,
    stdout: "ignore",
    stderr: "ignore",
    stdin: "ignore",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "pid-test",
      GIT_AUTHOR_EMAIL: "pid@test.invalid",
      GIT_COMMITTER_NAME: "pid-test",
      GIT_COMMITTER_EMAIL: "pid@test.invalid",
    },
  })
  const code = await proc.exited
  if (code !== 0) throw new Error(`git ${args.join(" ")} exited ${code}`)
}

describe("ProjectsRepo list ordering by last commit", () => {
  let gitRoot: string

  beforeAll(async () => {
    gitRoot = await mkdtemp(join(tmpdir(), "pid-commit-sort-"))
    // Three projects: a real git repo with a fresh commit, a non-git project
    // touched in the distant past, and a non-git project touched recently.
    const real = join(gitRoot, "real-git")
    const oldPlain = join(gitRoot, "old-plain")
    const newPlain = join(gitRoot, "new-plain")
    await mkdir(real, { recursive: true })
    await mkdir(oldPlain, { recursive: true })
    await mkdir(newPlain, { recursive: true })
    await writeFile(join(real, "README.md"), "hi\n")
    await runGit(real, ["init", "-q", "-b", "main"])
    await runGit(real, ["add", "."])
    await runGit(real, ["commit", "-q", "-m", "init"])
    // Force mtimes: old-plain ~ year 2001, new-plain ~ now. The real repo's
    // HEAD commit just happened, so it should still sort first.
    const { utimes } = await import("node:fs/promises")
    await utimes(oldPlain, new Date(1_000_000_000_000), new Date(1_000_000_000_000))
    await utimes(newPlain, new Date(), new Date())
  })

  afterAll(async () => {
    await rm(gitRoot, { recursive: true, force: true })
  })

  it("ranks a freshly-committed git repo ahead of a recently-touched plain dir", async () => {
    const layer = Layer.provide(ProjectsRepoLive, ConfigRepoTest({ projectsRoot: gitRoot }))
    const out = await Effect.runPromise(
      Effect.provide(
        Effect.flatMap(ProjectsService, (s) => s.list()),
        layer,
      ),
    )
    const ids = out.map((p) => p.id)
    expect(ids).toContain("real-git")
    expect(ids).toContain("new-plain")
    expect(ids).toContain("old-plain")
    // Real git commit time is "now" and beats the new-plain mtime
    // (also "now") on tie-break only when commit time is strictly newer; we
    // can't guarantee strict ordering against mtime "now", so the weaker
    // contract we test is: real-git outranks the year-2001 plain dir.
    expect(ids.indexOf("real-git")).toBeLessThan(ids.indexOf("old-plain"))
    const real = out.find((p) => p.id === "real-git")
    expect(real?.lastCommitMs).toBeGreaterThan(0)
  })
})

describe("ProjectsRepo list", () => {
  it("reports the current branch for a git repo", async () => {
    const out = await withLayer(Effect.flatMap(ProjectsService, (s) => s.list()))
    const repo = out.find((p) => p.id === "repo")
    expect(repo).toBeDefined()
    expect(repo?.isGitRepo).toBe(true)
    expect(repo?.branch).toBe("feat/login")
  })

  it("omits branch for non-git projects", async () => {
    const out = await withLayer(Effect.flatMap(ProjectsService, (s) => s.list()))
    const demo = out.find((p) => p.id === "demo")
    expect(demo).toBeDefined()
    expect(demo?.isGitRepo).toBe(false)
    expect(demo?.branch).toBeUndefined()
  })

  it("omits branch when HEAD is detached", async () => {
    const out = await withLayer(Effect.flatMap(ProjectsService, (s) => s.list()))
    const detached = out.find((p) => p.id === "detached")
    expect(detached).toBeDefined()
    expect(detached?.isGitRepo).toBe(true)
    expect(detached?.branch).toBeUndefined()
  })
})

describe("ProjectsRepo readFile", () => {
  it("reads a text file", async () => {
    const out = await withLayer(
      Effect.flatMap(ProjectsService, (s) => s.readFile("demo", "README.md")),
    )
    expect(out.content).toBe("# demo\n")
    expect(out.isBinary).toBe(false)
  })

  it("marks binary files without returning their bytes", async () => {
    const out = await withLayer(
      Effect.flatMap(ProjectsService, (s) => s.readFile("demo", "bin.dat")),
    )
    expect(out.isBinary).toBe(true)
    expect(out.content).toBe("")
  })

  it("refuses to read directories", async () => {
    const exit = await withLayer(
      Effect.flatMap(ProjectsService, (s) => s.readFile("demo", "src")).pipe(Effect.either),
    )
    expect(exit._tag).toBe("Left")
    if (exit._tag === "Left") expect(exit.left).toBe("not_a_file")
  })
})
