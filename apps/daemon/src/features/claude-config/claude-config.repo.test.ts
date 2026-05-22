import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect, Layer } from "effect"
import { ConfigRepoTest } from "../../platform/config.repo"
import { ProjectsRepoLive, ProjectsService } from "../projects/projects.repo"
import { ClaudeConfigRepoLive, ClaudeConfigService } from "./claude-config.repo"

let projectsRoot: string
let globalClaude: string

beforeAll(async () => {
  projectsRoot = await mkdtemp(join(tmpdir(), "pid-claude-projects-"))
  globalClaude = await mkdtemp(join(tmpdir(), "pid-claude-global-"))

  // Project with .claude/
  const projDir = join(projectsRoot, "demo")
  const projClaude = join(projDir, ".claude")
  await mkdir(join(projClaude, "skills", "tdd"), { recursive: true })
  await mkdir(join(projClaude, "skills", "tdd", "evals"), { recursive: true })
  await mkdir(join(projClaude, "hooks"), { recursive: true })
  await writeFile(
    join(projClaude, "settings.json"),
    JSON.stringify({
      hooks: { Stop: [{ hooks: [{ type: "command", command: "echo stop" }] }] },
      permissions: { allow: ["Bash(ls:*)"], defaultMode: "auto" },
    }),
  )
  await writeFile(
    join(projClaude, "skills", "tdd", "SKILL.md"),
    "---\nname: tdd\ndescription: write tests first\n---\nbody\n",
  )
  await writeFile(join(projClaude, "hooks", "pre.sh"), "#!/bin/sh\necho pre\n")
  await writeFile(join(projDir, "CLAUDE.md"), "# project guide\n")

  // Global ~/.claude/
  await mkdir(join(globalClaude, "skills", "concise"), { recursive: true })
  await mkdir(join(globalClaude, "hooks"), { recursive: true })
  await writeFile(
    join(globalClaude, "settings.json"),
    JSON.stringify({
      hooks: {
        PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "rtk hook" }] }],
      },
    }),
  )
  await writeFile(
    join(globalClaude, "skills", "concise", "SKILL.md"),
    "---\nname: concise\ndescription: compress\n---\nbody\n",
  )
  await writeFile(join(globalClaude, "hooks", "voice.sh"), "#!/bin/sh\n")
})

afterAll(async () => {
  await rm(projectsRoot, { recursive: true, force: true })
  await rm(globalClaude, { recursive: true, force: true })
})

const withLayer = <A, E>(fx: Effect.Effect<A, E, ClaudeConfigService>): Promise<A> => {
  const configLayer = ConfigRepoTest({ projectsRoot, claudeConfigDir: globalClaude })
  const projectsLive = Layer.provide(ProjectsRepoLive, configLayer)
  const claudeLive = Layer.provide(ClaudeConfigRepoLive, Layer.mergeAll(configLayer, projectsLive))
  return Effect.runPromise(Effect.provide(fx, claudeLive))
}

describe("ClaudeConfigRepo readGlobal", () => {
  it("returns hooks, skills and hook scripts from ~/.claude", async () => {
    const b = await withLayer(Effect.flatMap(ClaudeConfigService, (s) => s.readGlobal()))
    expect(b.scope).toBe("global")
    expect(b.skills).toHaveLength(1)
    expect(b.skills[0]?.id).toBe("concise")
    expect(b.skills[0]?.description).toBe("compress")
    expect(b.hookScripts.map((h) => h.name)).toEqual(["voice.sh"])
    expect(b.hooks).toHaveLength(1)
    expect(b.hooks[0]).toMatchObject({ event: "PreToolUse", matcher: "Bash" })
  })
})

describe("ClaudeConfigRepo readProject", () => {
  it("returns project-scoped config and detects evals dir", async () => {
    const b = await withLayer(Effect.flatMap(ClaudeConfigService, (s) => s.readProject("demo")))
    expect(b.scope).toBe("project")
    expect(b.skills).toHaveLength(1)
    expect(b.skills[0]?.id).toBe("tdd")
    expect(b.skills[0]?.hasEvals).toBe(true)
    expect(b.hookScripts.map((h) => h.name)).toEqual(["pre.sh"])
    expect(b.hooks[0]?.event).toBe("Stop")
    expect(b.claudeMd).toContain("project guide")
    expect(b.settings?.permissions?.allow).toEqual(["Bash(ls:*)"])
  })

  it("fails for missing projects", async () => {
    const ex = await withLayer(
      Effect.flatMap(ClaudeConfigService, (s) => s.readProject("missing")).pipe(Effect.either),
    )
    expect(ex._tag).toBe("Left")
    if (ex._tag === "Left") expect(ex.left).toBe("not_found")
  })

  it("rejects unsafe project ids", async () => {
    const ex = await withLayer(
      Effect.flatMap(ClaudeConfigService, (s) => s.readProject("../etc")).pipe(Effect.either),
    )
    expect(ex._tag).toBe("Left")
    if (ex._tag === "Left") expect(ex.left).toBe("forbidden")
  })
})

describe("ClaudeConfigRepo readSkill", () => {
  it("returns body and frontmatter for a global skill", async () => {
    const d = await withLayer(
      Effect.flatMap(ClaudeConfigService, (s) => s.readSkill("global", null, "concise")),
    )
    expect(d.frontmatter.name).toBe("concise")
    expect(d.body.trim()).toBe("body")
  })

  it("returns body for a project skill", async () => {
    const d = await withLayer(
      Effect.flatMap(ClaudeConfigService, (s) => s.readSkill("project", "demo", "tdd")),
    )
    expect(d.frontmatter.description).toBe("write tests first")
  })

  it("fails for unknown skill", async () => {
    const ex = await withLayer(
      Effect.flatMap(ClaudeConfigService, (s) => s.readSkill("global", null, "ghost")).pipe(
        Effect.either,
      ),
    )
    expect(ex._tag).toBe("Left")
    if (ex._tag === "Left") expect(ex.left).toBe("not_found")
  })
})
