import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect, Layer } from "effect"
import { ConfigRepoTest } from "../../platform/config.repo"
import { ProjectsRepoLive, ProjectsService } from "../projects/projects.repo"
import { LibraryRepoLive, LibraryService } from "./library.repo"

let projectsRoot: string
let homeShim: string
let libraryDir: string
let agenticRepoPath: string

beforeAll(async () => {
  projectsRoot = await mkdtemp(join(tmpdir(), "pid-lib-projects-"))
  homeShim = await mkdtemp(join(tmpdir(), "pid-lib-home-"))
  agenticRepoPath = await mkdtemp(join(tmpdir(), "pid-lib-agentic-"))

  libraryDir = join(homeShim, ".claude", "skills", "library")
  await mkdir(libraryDir, { recursive: true })

  // Catalog references one local skill (align) and one GitHub-sourced skill (auto-optimize).
  const yaml = [
    "default_dirs:",
    "  skills:",
    "    - default: .claude/skills/",
    `    - global: ${homeShim}/.claude/skills/`,
    "  agents:",
    "    - default: .claude/agents/",
    `    - global: ${homeShim}/.claude/agents/`,
    "library:",
    "  skills:",
    "    - name: align",
    "      description: align skill",
    `      source: ${homeShim}/.claude/skills/align/SKILL.md`,
    "    - name: auto-optimize",
    "      description: overnight",
    "      source: https://github.com/Pierre-Mike/agentic/blob/main/skills/auto-optimize/SKILL.md",
    "      requires: [skill:align]",
    "  agents:",
    "    - name: planner",
    "      description: planner",
    `      source: ${homeShim}/.claude/agents/planner/AGENT.md`,
    "",
  ].join("\n")
  await writeFile(join(libraryDir, "library.yaml"), yaml, "utf8")

  // align is installed globally; auto-optimize is not.
  await mkdir(join(homeShim, ".claude", "skills", "align"), { recursive: true })
  await writeFile(join(homeShim, ".claude", "skills", "align", "SKILL.md"), "x\n")
  await mkdir(join(homeShim, ".claude", "agents"), { recursive: true })

  // Project with a local skill install too.
  const projDir = join(projectsRoot, "demo")
  await mkdir(join(projDir, ".claude", "skills", "auto-optimize"), { recursive: true })
  await writeFile(join(projDir, ".claude", "skills", "auto-optimize", "SKILL.md"), "x\n")

  // Agentic repo fixture — has align (registered) and ghost (unregistered).
  await mkdir(join(agenticRepoPath, "skills", "align"), { recursive: true })
  await writeFile(join(agenticRepoPath, "skills", "align", "SKILL.md"), "x\n")
  await mkdir(join(agenticRepoPath, "skills", "ghost"), { recursive: true })

  process.env.PID_LIBRARY_DIR = libraryDir
  process.env.PID_AGENTIC_REPO_PATH = agenticRepoPath
  process.env.HOME = homeShim
})

afterAll(async () => {
  // biome-ignore lint/performance/noDelete: `process.env.X = undefined` coerces to the string "undefined" and would leak into sibling tests.
  delete process.env.PID_LIBRARY_DIR
  // biome-ignore lint/performance/noDelete: same reason as above.
  delete process.env.PID_AGENTIC_REPO_PATH
  await rm(projectsRoot, { recursive: true, force: true })
  await rm(homeShim, { recursive: true, force: true })
  await rm(agenticRepoPath, { recursive: true, force: true })
})

const withLayer = <A, E>(fx: Effect.Effect<A, E, LibraryService>): Promise<A> => {
  const configLayer = ConfigRepoTest({ projectsRoot, claudeConfigDir: join(homeShim, ".claude") })
  const projectsLive = Layer.provide(ProjectsRepoLive, configLayer)
  const libraryLive = Layer.provide(LibraryRepoLive, Layer.mergeAll(configLayer, projectsLive))
  return Effect.runPromise(Effect.provide(fx, libraryLive))
}

describe("LibraryRepo readCatalog", () => {
  it("returns catalog entries with global and local install status", async () => {
    const b = await withLayer(Effect.flatMap(LibraryService, (s) => s.readCatalog("demo")))
    expect(b.catalog.entries).toHaveLength(3)
    expect(b.statusByName["skills:align"]?.global).toBe("installed")
    expect(b.statusByName["skills:align"]?.local).toBe("not_installed")
    expect(b.statusByName["skills:auto-optimize"]?.local).toBe("installed")
    expect(b.statusByName["skills:auto-optimize"]?.global).toBe("not_installed")
    expect(b.statusByName["agents:planner"]?.global).toBe("not_installed")
  })

  it("omits local probe when projectId is null", async () => {
    const b = await withLayer(Effect.flatMap(LibraryService, (s) => s.readCatalog(null)))
    expect(b.statusByName["skills:auto-optimize"]?.local).toBe("not_installed")
  })

  it("fails not_found for an unknown project", async () => {
    const ex = await withLayer(
      Effect.flatMap(LibraryService, (s) => s.readCatalog("missing")).pipe(Effect.either),
    )
    expect(ex._tag).toBe("Left")
    if (ex._tag === "Left") expect(ex.left).toBe("not_found")
  })
})

describe("LibraryRepo listAgenticRepo", () => {
  it("lists categories and marks registered items", async () => {
    const a = await withLayer(Effect.flatMap(LibraryService, (s) => s.listAgenticRepo("skills")))
    expect(a.items.map((i) => i.name)).toEqual(["align", "ghost"])
    expect(a.items.find((i) => i.name === "align")?.registered).toBe(true)
    expect(a.items.find((i) => i.name === "ghost")?.registered).toBe(false)
  })

  it("returns empty items for a category dir that doesn't exist", async () => {
    const a = await withLayer(Effect.flatMap(LibraryService, (s) => s.listAgenticRepo("tools")))
    expect(a.items).toEqual([])
  })
})
