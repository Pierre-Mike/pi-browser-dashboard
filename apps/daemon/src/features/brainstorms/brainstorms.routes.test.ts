import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect, Layer } from "effect"
import { parseCanvas, serializeCanvas } from "../canvas/canvas.core"
import { __resetCanvasRoomsForTests } from "../canvas/canvas.repo"
import { type Project, ProjectsRepoTest } from "../projects/projects.repo"
import { BrainstormsRepoLive } from "./brainstorms.repo"
import { createApp } from "./brainstorms.routes"

// Drive the real route handlers over the live repo layer backed by an
// in-memory ProjectsRepoTest fixture pointing at a real tmp project tree
// (mirrors pid-apps.routes.test.ts).
let root: string

const appFor = (proj: Project) => {
  const layer = Layer.provide(BrainstormsRepoLive, ProjectsRepoTest([proj]))
  return createApp((eff) => Effect.runPromise(Effect.provide(eff, layer)))
}

let app: ReturnType<typeof appFor>

const seededSnapshot = {
  version: 1,
  updatedAt: "2026-01-01T00:00:00.000Z",
  nodes: [{ id: "n1", position: { x: 10, y: 20 }, data: { label: "seeded" } }],
  edges: [],
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "brainstorms-routes-"))
  const dir = join(root, ".pid", "brainstorms")
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, "zeta.canvas.json"), JSON.stringify(seededSnapshot))
  await writeFile(
    join(dir, "alpha.canvas.json"),
    JSON.stringify({ version: 1, nodes: [], edges: [] }),
  )
  await writeFile(join(dir, "junk.txt"), "not a brainstorm")
  app = appFor({ id: "projA", name: "projA", path: root, isGitRepo: false, lastModified: 0 })
})

afterAll(async () => {
  __resetCanvasRoomsForTests()
  await rm(root, { recursive: true, force: true })
})

const post = (path: string, body: unknown) =>
  app.request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  })

describe("GET /:id/brainstorms (list)", () => {
  it("returns discovered brainstorms sorted by id, with file + updatedAt", async () => {
    const res = await app.request("/projA/brainstorms")
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      id: string
      label: string
      file: string
      updatedAt: string
    }[]
    expect(body.map((b) => b.id)).toEqual(["alpha", "zeta"])
    expect(body[1]?.file).toBe(join(root, ".pid", "brainstorms", "zeta.canvas.json"))
    expect(Date.parse(body[0]?.updatedAt ?? "")).toBeGreaterThan(0)
  })

  it("404s an unknown project", async () => {
    expect((await app.request("/ghost/brainstorms")).status).toBe(404)
  })

  it("returns [] for a project with no .pid/brainstorms directory", async () => {
    const bare = await mkdtemp(join(tmpdir(), "brainstorms-bare-"))
    const bareApp = appFor({
      id: "projB",
      name: "projB",
      path: bare,
      isGitRepo: false,
      lastModified: 0,
    })
    const res = await bareApp.request("/projB/brainstorms")
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([])
    await rm(bare, { recursive: true, force: true })
  })
})

describe("POST /:id/brainstorms (create)", () => {
  it("creates an empty canvas document and returns 201 with the discovered shape", async () => {
    const res = await post("/projA/brainstorms", { name: "auth-flow" })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { id: string; file: string }
    expect(body.id).toBe("auth-flow")

    const onDisk = parseCanvas(JSON.parse(await readFile(body.file, "utf8")))
    expect(onDisk.nodes).toEqual([])
    expect(onDisk.edges).toEqual([])

    // and it's now visible through the list route — no drift from discovery.
    const list = await app.request("/projA/brainstorms")
    const ids = ((await list.json()) as { id: string }[]).map((b) => b.id)
    expect(ids).toContain("auth-flow")
  })

  it("400s a non-JSON or malformed body", async () => {
    expect((await post("/projA/brainstorms", "{not json")).status).toBe(400)
    expect((await post("/projA/brainstorms", [1])).status).toBe(400)
    expect((await post("/projA/brainstorms", { name: 42 })).status).toBe(400)
  })

  it("400s an invalid name", async () => {
    expect((await post("/projA/brainstorms", { name: "Bad Name" })).status).toBe(400)
    expect((await post("/projA/brainstorms", { name: "../escape" })).status).toBe(400)
  })

  it("409s a name that already exists", async () => {
    expect((await post("/projA/brainstorms", { name: "zeta" })).status).toBe(409)
  })
})

describe("GET /:id/brainstorms/:slug (snapshot)", () => {
  it("returns the parsed canvas snapshot of an existing document", async () => {
    const res = await app.request("/projA/brainstorms/zeta")
    expect(res.status).toBe(200)
    const snap = parseCanvas(await res.json())
    expect(snap.nodes[0]?.data).toEqual({ label: "seeded" })
  })

  it("404s a document that was never created (no silent auto-create)", async () => {
    expect((await app.request("/projA/brainstorms/ghost")).status).toBe(404)
  })

  it("404s a traversal-shaped slug before touching the filesystem", async () => {
    expect((await app.request("/projA/brainstorms/..%2fsecrets")).status).toBe(404)
  })
})

describe("POST /:id/brainstorms/:slug (publish)", () => {
  it("persists the snapshot to the document and stamps updatedAt", async () => {
    const res = await post("/projA/brainstorms/alpha", seededSnapshot)
    expect(res.status).toBe(200)
    const stamped = parseCanvas(await res.json())
    expect(stamped.nodes).toHaveLength(1)
    expect(stamped.updatedAt).not.toBe(seededSnapshot.updatedAt)

    const onDisk = parseCanvas(
      JSON.parse(await readFile(join(root, ".pid", "brainstorms", "alpha.canvas.json"), "utf8")),
    )
    expect(serializeCanvas(onDisk)).toBe(serializeCanvas(stamped))
  })

  it("400s a malformed snapshot", async () => {
    expect((await post("/projA/brainstorms/alpha", "null")).status).toBe(400)
  })

  it("404s publishing to a nonexistent document", async () => {
    expect((await post("/projA/brainstorms/ghost", seededSnapshot)).status).toBe(404)
  })
})
