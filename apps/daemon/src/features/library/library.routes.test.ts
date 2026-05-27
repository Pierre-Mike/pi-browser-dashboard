import { describe, expect, it } from "bun:test"
import { Effect, ManagedRuntime } from "effect"
import { Hono } from "hono"
import { LIBRARY_CATEGORIES, type LibraryCategory } from "./library.core"
import {
  type AgenticListing,
  type CatalogBundle,
  LibraryRepoTest,
  LibraryService,
} from "./library.repo"

const sampleCatalog: CatalogBundle = {
  catalog: {
    defaultDirs: {
      skills: { default: ".claude/skills/", global: "~/.claude/skills/" },
      agents: { default: ".claude/agents/", global: "~/.claude/agents/" },
      tools: { default: ".claude/tools/", global: "~/.claude/tools/" },
      prompts: { default: ".claude/commands/", global: "~/.claude/commands/" },
      statuslines: { default: ".claude/statuslines/", global: "~/.claude/statuslines/" },
      extensions: { default: ".pi/extensions/", global: "~/.pi/agent/extensions/" },
    },
    entries: [
      {
        name: "align",
        type: "skills",
        description: "align",
        source: "/tmp/align/SKILL.md",
      },
    ],
  },
  catalogPath: "/tmp/library.yaml",
  statusByName: {
    "skills:align": { global: "installed", local: "not_installed" },
  },
}

const sampleAgentic: AgenticListing = {
  repoPath: "/tmp/agentic",
  category: "skills",
  items: [{ name: "align", path: "/tmp/agentic/skills/align", registered: true }],
}

const buildApp = () => {
  const testRuntime = ManagedRuntime.make(
    LibraryRepoTest({
      catalog: sampleCatalog,
      agentic: { skills: sampleAgentic },
    }),
  )
  const app = new Hono()
    .get("/catalog", async (c) => {
      const projectId = c.req.query("projectId") ?? null
      const result = await testRuntime.runPromise(
        Effect.flatMap(LibraryService, (s) => s.readCatalog(projectId)).pipe(Effect.either),
      )
      if (result._tag === "Left")
        return c.json(
          { error: result.left },
          result.left === "forbidden" ? 403 : result.left === "catalog_invalid" ? 422 : 404,
        )
      return c.json(result.right)
    })
    .get("/agentic", async (c) => {
      const category = c.req.query("category") as LibraryCategory | undefined
      if (!category || !(LIBRARY_CATEGORIES as readonly string[]).includes(category)) {
        return c.json({ error: "invalid_category" }, 400)
      }
      const result = await testRuntime.runPromise(
        Effect.flatMap(LibraryService, (s) => s.listAgenticRepo(category)).pipe(Effect.either),
      )
      if (result._tag === "Left")
        return c.json({ error: result.left }, result.left === "agentic_repo_missing" ? 404 : 422)
      return c.json(result.right)
    })
  return app
}

describe("library routes", () => {
  it("GET /catalog returns entries and statusByName", async () => {
    const res = await buildApp().request("/catalog")
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.catalog.entries).toHaveLength(1)
    expect(body.statusByName["skills:align"].global).toBe("installed")
  })

  it("GET /agentic?category=skills returns the listing", async () => {
    const res = await buildApp().request("/agentic?category=skills")
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.items[0].name).toBe("align")
    expect(body.items[0].registered).toBe(true)
  })

  it("GET /agentic rejects unknown category with 400", async () => {
    const res = await buildApp().request("/agentic?category=nope")
    expect(res.status).toBe(400)
  })

  it("GET /agentic 404s when repo is missing for that category", async () => {
    const res = await buildApp().request("/agentic?category=tools")
    expect(res.status).toBe(404)
  })
})
