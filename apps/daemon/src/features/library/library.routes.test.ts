import { describe, expect, it } from "bun:test"
import { Effect, ManagedRuntime } from "effect"
import { Hono } from "hono"
import { LIBRARY_CATEGORIES, type LibraryCategory } from "./library.core"
import {
  type AgenticListing,
  type CatalogBundle,
  type LibraryError,
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

const buildAppWithMutations = (overrides?: {
  installEntry?: Parameters<typeof LibraryRepoTest>[0]
  fixtures?: Parameters<typeof LibraryRepoTest>[0]
}) => {
  const fixtures = {
    catalog: sampleCatalog,
    agentic: { skills: sampleAgentic },
    ...(overrides?.installEntry ?? {}),
    ...(overrides?.fixtures ?? {}),
  }
  const testRuntime = ManagedRuntime.make(LibraryRepoTest(fixtures))
  return new Hono()
    .post("/init", async (c) => {
      const body = await c.req.json().catch(() => null)
      if (!body || typeof body.repoUrl !== "string" || body.repoUrl.trim() === "") {
        return c.json({ error: "bad_request" }, 400)
      }
      const branch =
        typeof body.branch === "string" && body.branch.trim() !== ""
          ? body.branch.trim()
          : undefined
      const result = await testRuntime.runPromise(
        Effect.flatMap(LibraryService, (s) =>
          s.initLibrary({ repoUrl: body.repoUrl.trim(), ...(branch ? { branch } : {}) }),
        ).pipe(Effect.either),
      )
      if (result._tag === "Left") {
        const status = result.left === "already_initialized" ? 409 : 422
        return c.json({ error: result.left }, status)
      }
      return c.json(result.right)
    })
    .post("/use", async (c) => {
      const body = await c.req.json()
      const result = await testRuntime.runPromise(
        Effect.flatMap(LibraryService, (s) =>
          s.installEntry({
            name: body.name,
            type: body.type,
            scope: body.scope,
            projectId: body.projectId ?? null,
          }),
        ).pipe(Effect.either),
      )
      if (result._tag === "Left") return c.json({ error: result.left }, 422)
      return c.json(result.right)
    })
    .post("/add", async (c) => {
      const body = await c.req.json()
      const result = await testRuntime.runPromise(
        Effect.flatMap(LibraryService, (s) =>
          s.addEntry({
            name: body.name,
            type: body.type,
            description: body.description,
            source: body.source,
            ...(body.requires ? { requires: body.requires } : {}),
          }),
        ).pipe(Effect.either),
      )
      if (result._tag === "Left") return c.json({ error: result.left }, 422)
      return c.json({ entry: result.right })
    })
    .post("/push", async (c) => {
      const body = await c.req.json()
      const result = await testRuntime.runPromise(
        Effect.flatMap(LibraryService, (s) =>
          s.pushEntry({
            name: body.name,
            type: body.type,
            scope: body.scope,
            projectId: body.projectId ?? null,
          }),
        ).pipe(Effect.either),
      )
      if (result._tag === "Left") return c.json({ error: result.left }, 422)
      return c.json(result.right)
    })
    .post("/remove", async (c) => {
      const body = await c.req.json()
      const result = await testRuntime.runPromise(
        Effect.flatMap(LibraryService, (s) =>
          s.removeEntry({
            name: body.name,
            type: body.type,
            scope: body.scope,
            deleteLocal: body.deleteLocal,
            projectId: body.projectId ?? null,
          }),
        ).pipe(Effect.either),
      )
      if (result._tag === "Left") return c.json({ error: result.left }, 422)
      return c.json({ removed: true })
    })
    .post("/sync", async (c) => {
      const body = await c.req.json()
      const result = await testRuntime.runPromise(
        Effect.flatMap(LibraryService, (s) =>
          s.syncAll({
            scope: body.scope,
            projectId: body.projectId ?? null,
          }),
        ).pipe(Effect.either),
      )
      if (result._tag === "Left") return c.json({ error: result.left }, 422)
      return c.json(result.right)
    })
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

  it("POST /use installs and returns the installed names", async () => {
    const res = await buildAppWithMutations().request("/use", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "align", type: "skills", scope: "global" }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.installed).toEqual(["align"])
  })

  it("POST /add returns the registered entry", async () => {
    const res = await buildAppWithMutations().request("/add", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "new",
        type: "skills",
        description: "x",
        source: "/tmp/new/SKILL.md",
      }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.entry.name).toBe("new")
  })

  it("POST /push returns a commit sha", async () => {
    const res = await buildAppWithMutations().request("/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "align", type: "skills", scope: "global" }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.commitSha).toBe("stub-sha")
  })

  it("POST /remove returns removed:true", async () => {
    const res = await buildAppWithMutations().request("/remove", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "align",
        type: "skills",
        scope: "global",
        deleteLocal: false,
      }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.removed).toBe(true)
  })

  it("POST /init clones a library repo and returns the catalog path", async () => {
    const res = await buildAppWithMutations().request("/init", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repoUrl: "https://github.com/me/the-library.git" }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(typeof body.catalogPath).toBe("string")
  })

  it("POST /init rejects a missing repoUrl with 400", async () => {
    const res = await buildAppWithMutations().request("/init", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
  })

  it("POST /init returns 409 when a catalog already exists", async () => {
    const res = await buildAppWithMutations({
      fixtures: { initLibrary: () => Effect.fail<LibraryError>("already_initialized") },
    }).request("/init", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repoUrl: "https://github.com/me/the-library.git" }),
    })
    expect(res.status).toBe(409)
  })

  it("POST /sync returns an outcomes array", async () => {
    const res = await buildAppWithMutations().request("/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.outcomes)).toBe(true)
  })
})
