import { describe, expect, it } from "bun:test"
import { Effect, ManagedRuntime } from "effect"
import { Hono } from "hono"
import type { SkillDetail } from "./claude-config.core"
import { ClaudeConfigRepoTest, ClaudeConfigService } from "./claude-config.repo"
import type { ScopeBundle } from "./claude-config.repo"

const sampleGlobal: ScopeBundle = {
  scope: "global",
  root: "/tmp/.claude",
  skills: [
    {
      id: "concise",
      path: "/tmp/.claude/skills/concise",
      name: "concise",
      bytes: 100,
      hasEvals: false,
    },
  ],
  hookScripts: [{ name: "voice.sh", path: "/tmp/.claude/hooks/voice.sh", bytes: 10 }],
  hooks: [{ event: "Stop", command: "echo" }],
}

const sampleProject: ScopeBundle = {
  scope: "project",
  root: "/tmp/proj/.claude",
  skills: [],
  hookScripts: [],
  hooks: [],
}

const sampleSkill: SkillDetail = {
  id: "concise",
  path: "/tmp/.claude/skills/concise",
  name: "concise",
  description: "x",
  bytes: 100,
  hasEvals: false,
  body: "hello",
  frontmatter: { name: "concise", description: "x" },
}

const buildApp = () => {
  const testRuntime = ManagedRuntime.make(
    ClaudeConfigRepoTest({
      global: sampleGlobal,
      projects: { demo: sampleProject },
      skills: { concise: sampleSkill },
    }),
  )
  const app = new Hono()
    .get("/global", async (c) =>
      c.json(
        await testRuntime.runPromise(Effect.flatMap(ClaudeConfigService, (s) => s.readGlobal())),
      ),
    )
    .get("/projects/:id", async (c) => {
      const id = c.req.param("id")
      const result = await testRuntime.runPromise(
        Effect.flatMap(ClaudeConfigService, (s) => s.readProject(id)).pipe(Effect.either),
      )
      if (result._tag === "Left")
        return c.json({ error: result.left }, result.left === "forbidden" ? 403 : 404)
      return c.json(result.right)
    })
    .get("/global/skills/:skillId", async (c) => {
      const skillId = c.req.param("skillId")
      const result = await testRuntime.runPromise(
        Effect.flatMap(ClaudeConfigService, (s) => s.readSkill("global", null, skillId)).pipe(
          Effect.either,
        ),
      )
      if (result._tag === "Left")
        return c.json({ error: result.left }, result.left === "forbidden" ? 403 : 404)
      return c.json(result.right)
    })
  return app
}

describe("claude-config routes", () => {
  it("GET /global returns the global bundle", async () => {
    const res = await buildApp().request("/global")
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.scope).toBe("global")
    expect(body.skills).toHaveLength(1)
  })

  it("GET /projects/:id returns project bundle", async () => {
    const res = await buildApp().request("/projects/demo")
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.scope).toBe("project")
  })

  it("GET /projects/:id 404s for unknown projects", async () => {
    const res = await buildApp().request("/projects/missing")
    expect(res.status).toBe(404)
  })

  it("GET /global/skills/:id returns skill body", async () => {
    const res = await buildApp().request("/global/skills/concise")
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.body).toBe("hello")
  })

  it("GET /global/skills/:id 404s for missing skills", async () => {
    const res = await buildApp().request("/global/skills/ghost")
    expect(res.status).toBe(404)
  })
})
