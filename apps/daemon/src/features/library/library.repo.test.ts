import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect, Layer } from "effect"
import { ConfigRepoTest } from "../../platform/config.repo"
import { ProjectsRepoLive } from "../projects/projects.repo"
import { type GitClientRecorder, GitClientTestLayer, makeGitClientRecorder } from "./installer"
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
  delete process.env.PID_LIBRARY_DIR
  delete process.env.PID_AGENTIC_REPO_PATH
  await rm(projectsRoot, { recursive: true, force: true })
  await rm(homeShim, { recursive: true, force: true })
  await rm(agenticRepoPath, { recursive: true, force: true })
})

const withLayer = <A, E>(
  fx: Effect.Effect<A, E, LibraryService>,
  recorder?: GitClientRecorder,
): Promise<A> => {
  const configLayer = ConfigRepoTest({ projectsRoot, claudeConfigDir: join(homeShim, ".claude") })
  const projectsLive = Layer.provide(ProjectsRepoLive, configLayer)
  const gitLayer = GitClientTestLayer(recorder ?? makeGitClientRecorder())
  const libraryLive = Layer.provide(
    LibraryRepoLive,
    Layer.mergeAll(configLayer, projectsLive, gitLayer),
  )
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

// Rewrite the catalog to a known-shape that lets us drive install/push/sync
// tests deterministically without colliding with the readCatalog fixture.
const writeMutationCatalog = async () => {
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
    "    - name: local-skill",
    "      description: local",
    `      source: ${homeShim}/sources/local-skill/SKILL.md`,
    "  agents:",
    "    - name: gh-agent",
    "      description: github",
    "      source: https://github.com/example/repo/blob/main/agents/gh-agent/AGENT.md",
    "",
  ].join("\n")
  await writeFile(join(homeShim, ".claude", "skills", "library", "library.yaml"), yaml, "utf8")
  // Source dir for local-skill.
  const src = join(homeShim, "sources", "local-skill")
  await mkdir(src, { recursive: true })
  await writeFile(join(src, "SKILL.md"), "fresh\n")
}

describe("LibraryRepo installEntry", () => {
  it("copies a local-sourced skill into the global scope", async () => {
    await writeMutationCatalog()
    const dest = join(homeShim, ".claude", "skills", "local-skill")
    await rm(dest, { recursive: true, force: true })

    const result = await withLayer(
      Effect.flatMap(LibraryService, (s) =>
        s.installEntry({ name: "local-skill", type: "skills", scope: "global" }),
      ),
    )
    expect(result.installed).toEqual(["local-skill"])
    expect(await readFile(join(dest, "SKILL.md"), "utf8")).toBe("fresh\n")
  })

  it("uses GitClient.clone for GitHub-sourced entries", async () => {
    await writeMutationCatalog()
    const dest = join(homeShim, ".claude", "agents", "gh-agent")
    await rm(dest, { recursive: true, force: true })

    const recorder = makeGitClientRecorder({
      cloneContents: async (dst) => {
        await mkdir(join(dst, "agents", "gh-agent"), { recursive: true })
        await writeFile(join(dst, "agents", "gh-agent", "AGENT.md"), "cloned\n")
      },
    })
    const result = await withLayer(
      Effect.flatMap(LibraryService, (s) =>
        s.installEntry({ name: "gh-agent", type: "agents", scope: "global" }),
      ),
      recorder,
    )
    expect(result.installed).toEqual(["gh-agent"])
    expect(await readFile(join(dest, "AGENT.md"), "utf8")).toBe("cloned\n")
    expect(recorder.calls.find((c) => c.method === "clone")).toBeDefined()
  })

  it("fails forbidden when name has path-traversal segments", async () => {
    const ex = await withLayer(
      Effect.flatMap(LibraryService, (s) =>
        s.installEntry({ name: "..", type: "skills", scope: "global" }),
      ).pipe(Effect.either),
    )
    expect(ex._tag).toBe("Left")
    if (ex._tag === "Left") expect(ex.left).toBe("forbidden")
  })

  it("fails not_found when local scope is requested without a projectId", async () => {
    const ex = await withLayer(
      Effect.flatMap(LibraryService, (s) =>
        s.installEntry({ name: "align", type: "skills", scope: "local" }),
      ).pipe(Effect.either),
    )
    expect(ex._tag).toBe("Left")
    if (ex._tag === "Left") expect(ex.left).toBe("not_found")
  })
})

describe("LibraryRepo addEntry / removeEntry", () => {
  // These flows mutate the catalog via mutateCatalog → pull → write → push.
  // We point the daemon at a real local-only git repo so pull/commit/push are
  // safe no-ops in the recorder, and verify the YAML actually changes on disk.
  it("appends a new entry and re-reads it via the parser", async () => {
    const recorder = makeGitClientRecorder()
    const before = await readFile(
      join(homeShim, ".claude", "skills", "library", "library.yaml"),
      "utf8",
    )

    const entry = await withLayer(
      Effect.flatMap(LibraryService, (s) =>
        s.addEntry({
          name: "fresh-skill",
          type: "skills",
          description: "added in test",
          source: "/tmp/fresh/SKILL.md",
        }),
      ),
      recorder,
    )
    expect(entry.name).toBe("fresh-skill")
    const after = await readFile(
      join(homeShim, ".claude", "skills", "library", "library.yaml"),
      "utf8",
    )
    expect(after).toContain("fresh-skill")
    expect(after).not.toBe(before)
    expect(recorder.calls.map((c) => c.method)).toEqual(["pullFastForward", "commitAndPush"])
  })

  it("removes an entry and confirms it's gone from the file", async () => {
    const recorder = makeGitClientRecorder()
    await withLayer(
      Effect.flatMap(LibraryService, (s) =>
        s.removeEntry({
          name: "fresh-skill",
          type: "skills",
          deleteLocal: false,
          scope: "global",
        }),
      ),
      recorder,
    )
    const after = await readFile(
      join(homeShim, ".claude", "skills", "library", "library.yaml"),
      "utf8",
    )
    expect(after).not.toContain("fresh-skill")
  })

  it("with deleteLocal=true also removes the install directory", async () => {
    const localInstall = join(homeShim, ".claude", "skills", "local-skill")
    await mkdir(localInstall, { recursive: true })
    await writeFile(join(localInstall, "SKILL.md"), "x\n")
    const recorder = makeGitClientRecorder()
    await withLayer(
      Effect.flatMap(LibraryService, (s) =>
        s.removeEntry({
          name: "local-skill",
          type: "skills",
          deleteLocal: true,
          scope: "global",
        }),
      ),
      recorder,
    )
    const ex = await readFile(join(localInstall, "SKILL.md"), "utf8").catch(() => null)
    expect(ex).toBeNull()
  })
})

describe("LibraryRepo syncAll", () => {
  it("re-installs every entry currently installed in scope", async () => {
    // Restore the local-source catalog from earlier tests by writing a clean one.
    const yaml = [
      "default_dirs:",
      "  skills:",
      "    - default: .claude/skills/",
      `    - global: ${homeShim}/.claude/skills/`,
      "library:",
      "  skills:",
      "    - name: sync-target",
      "      description: x",
      `      source: ${homeShim}/sync-src/SKILL.md`,
      "",
    ].join("\n")
    await writeFile(join(homeShim, ".claude", "skills", "library", "library.yaml"), yaml, "utf8")
    // Set up source content + the install destination to mark it "installed".
    const src = join(homeShim, "sync-src")
    await mkdir(src, { recursive: true })
    await writeFile(join(src, "SKILL.md"), "v2\n")
    const dest = join(homeShim, ".claude", "skills", "sync-target")
    await mkdir(dest, { recursive: true })
    await writeFile(join(dest, "SKILL.md"), "v1\n")

    const result = await withLayer(
      Effect.flatMap(LibraryService, (s) => s.syncAll({ scope: "global" })),
    )
    expect(result.outcomes).toHaveLength(1)
    expect(result.outcomes[0]?.name).toBe("sync-target")
    expect(result.outcomes[0]?.ok).toBe(true)
    expect(await readFile(join(dest, "SKILL.md"), "utf8")).toBe("v2\n")
  })
})

describe("LibraryRepo initLibrary", () => {
  it("clones the repo into the library dir when no catalog exists yet", async () => {
    const freshLib = join(homeShim, "fresh-lib")
    process.env.PID_LIBRARY_DIR = freshLib
    try {
      const recorder = makeGitClientRecorder({
        cloneContents: async (dst) => {
          const yaml = [
            "default_dirs:",
            "  skills:",
            "    - default: .claude/skills/",
            `    - global: ${homeShim}/.claude/skills/`,
            "library:",
            "  skills:",
            "    - name: seed",
            "      description: seeded",
            `      source: ${homeShim}/seed/SKILL.md`,
            "",
          ].join("\n")
          await writeFile(join(dst, "library.yaml"), yaml, "utf8")
        },
      })
      const result = await withLayer(
        Effect.flatMap(LibraryService, (s) =>
          s.initLibrary({ repoUrl: "https://github.com/me/the-library.git" }),
        ),
        recorder,
      )
      expect(result.catalogPath).toBe(join(freshLib, "library.yaml"))
      expect(recorder.calls.find((c) => c.method === "clone")).toBeDefined()
      // The catalog is now readable through the service.
      const bundle = await withLayer(Effect.flatMap(LibraryService, (s) => s.readCatalog(null)))
      expect(bundle.catalog.entries.map((e) => e.name)).toContain("seed")
    } finally {
      process.env.PID_LIBRARY_DIR = libraryDir
    }
  })

  it("refuses to init when a catalog already exists", async () => {
    // libraryDir already holds a library.yaml from earlier tests.
    const err = await withLayer(
      Effect.flatMap(LibraryService, (s) =>
        s.initLibrary({ repoUrl: "https://github.com/me/the-library.git" }),
      ).pipe(Effect.flip),
    )
    expect(err).toBe("already_initialized")
  })

  it("rejects a cloned repo that has no library.yaml", async () => {
    const freshLib = join(homeShim, "fresh-lib-empty")
    process.env.PID_LIBRARY_DIR = freshLib
    try {
      const recorder = makeGitClientRecorder({
        cloneContents: async (dst) => {
          await writeFile(join(dst, "README.md"), "no catalog here\n", "utf8")
        },
      })
      const err = await withLayer(
        Effect.flatMap(LibraryService, (s) =>
          s.initLibrary({ repoUrl: "https://github.com/me/not-a-library.git" }),
        ).pipe(Effect.flip),
        recorder,
      )
      expect(err).toBe("source_invalid")
    } finally {
      process.env.PID_LIBRARY_DIR = libraryDir
    }
  })
})
