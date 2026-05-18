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
