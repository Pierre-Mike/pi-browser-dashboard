import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect, Layer } from "effect"
import { type Project, ProjectsRepoTest } from "../projects/projects.repo"
import { PidAppsRepoLive } from "./pid-apps.repo"
import { createApp } from "./pid-apps.routes"

// Drive the real route handlers over the live repo layer backed by an in-memory
// ProjectsRepoTest fixture pointing at a real tmp project tree (so the serve
// route streams real files).
let root: string

const appFor = (proj: Project) => {
  const layer = Layer.provide(PidAppsRepoLive, ProjectsRepoTest([proj]))
  return createApp((eff) => Effect.runPromise(Effect.provide(eff, layer)))
}

let app: ReturnType<typeof appFor>

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "pidapps-routes-"))
  const pid = join(root, ".pid")
  await mkdir(join(pid, "spec", "assets"), { recursive: true })
  await writeFile(join(pid, "index.html"), "<h1>default app</h1>")
  await writeFile(join(pid, "spec", "main.html"), "<h1>spec main</h1>")
  await writeFile(join(pid, "spec", "index.html"), "<h1>spec index</h1>")
  await writeFile(join(pid, "spec", "pid-app.json"), JSON.stringify({ entry: "main.html" }))
  await writeFile(join(pid, "spec", "assets", "app.js"), "console.log(1)")
  await writeFile(join(pid, "settings.json"), "{}")
  app = appFor({ id: "projA", name: "projA", path: root, isGitRepo: false, lastModified: 0 })
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

describe("GET /:id/pid-apps (list)", () => {
  it("returns the discovered apps as JSON", async () => {
    const res = await app.request("/projA/pid-apps")
    expect(res.status).toBe(200)
    const body = (await res.json()) as { id: string }[]
    expect(body.map((a) => a.id)).toEqual(["default", "spec"])
  })

  it("404s an unknown project (list route is not shadowed by the serve route)", async () => {
    expect((await app.request("/ghost/pid-apps")).status).toBe(404)
  })
})

describe("GET /:id/pid-apps/:appId/* (serve)", () => {
  it("serves the default app index.html with CSP, nosniff, and no-cache", async () => {
    const res = await app.request("/projA/pid-apps/default/index.html")
    expect(res.status).toBe(200)
    expect(res.headers.get("Content-Type")).toBe("text/html; charset=utf-8")
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff")
    expect(res.headers.get("Cache-Control")).toBe("no-cache")
    const csp = res.headers.get("Content-Security-Policy") ?? ""
    expect(csp).toContain("default-src 'none'")
    expect(csp).toContain("connect-src 'none'")
    expect(await res.text()).toContain("default app")
  })

  it("serves the manifest entry override for the bare app path", async () => {
    const res = await app.request("/projA/pid-apps/spec")
    expect(res.status).toBe(200)
    expect(await res.text()).toContain("spec main")
  })

  it("serves a JS sub-resource with the right mime and CSP (every response)", async () => {
    const res = await app.request("/projA/pid-apps/spec/assets/app.js")
    expect(res.status).toBe(200)
    expect(res.headers.get("Content-Type")).toBe("text/javascript; charset=utf-8")
    expect(res.headers.get("Cache-Control")).toBe("private, max-age=30")
    expect(res.headers.get("Content-Security-Policy")).toContain("default-src 'none'")
  })

  it("rejects single- and double-encoded traversal before the filesystem", async () => {
    expect((await app.request("/projA/pid-apps/spec/..%2f..%2fsettings.json")).status).toBe(400)
    expect((await app.request("/projA/pid-apps/spec/..%252f..%252fsettings.json")).status).toBe(400)
  })

  it("404s a reserved appId at the serve route (independent of discovery)", async () => {
    expect((await app.request("/projA/pid-apps/extensions/manifest.json")).status).toBe(404)
  })

  it("404s a valid but non-existent appId", async () => {
    expect((await app.request("/projA/pid-apps/ghost/index.html")).status).toBe(404)
  })
})

describe("POST /:id/pid-apps (create)", () => {
  const post = (path: string, body: unknown) =>
    app.request(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    })

  it("creates a new app and returns 201 with the discovered PidApp shape", async () => {
    const res = await post("/projA/pid-apps", { name: "notes" })
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({
      id: "notes",
      label: "notes",
      entry: "index.html",
      root: "notes",
    })

    // and it's now visible through the list route — no drift from discovery.
    const list = await app.request("/projA/pid-apps")
    const ids = ((await list.json()) as { id: string }[]).map((a) => a.id)
    expect(ids).toContain("notes")
  })

  it("400s a non-JSON body", async () => {
    expect((await post("/projA/pid-apps", "{not json")).status).toBe(400)
  })

  it("400s a malformed body (non-object, or missing/wrong-typed name)", async () => {
    expect((await post("/projA/pid-apps", [1, 2, 3])).status).toBe(400)
    expect((await post("/projA/pid-apps", { notName: "x" })).status).toBe(400)
    expect((await post("/projA/pid-apps", { name: 42 })).status).toBe(400)
  })

  it("400s an invalid name", async () => {
    expect((await post("/projA/pid-apps", { name: "Bad Name" })).status).toBe(400)
  })

  it("409s a name whose app dir already exists and is non-empty", async () => {
    expect((await post("/projA/pid-apps", { name: "spec" })).status).toBe(409)
  })
})
