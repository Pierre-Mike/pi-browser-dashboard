import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Either } from "effect"
import { type CanvasSnapshot, parseCanvas as decodeCanvas } from "../canvas/canvas.core"
import { __resetCanvasRoomsForTests, __resetJsonCanvasRoomsForTests } from "../canvas/canvas.io"
import { __resetExcalidrawRoomsForTests } from "../canvas/excalidraw.io"
import { createApp } from "./brainstorms.routes"

// This suite asserts on documents the routes just produced, so the decode
// always succeeds — unwrap the Right and let a Left fail the test loudly.
const parseCanvas = (json: unknown): CanvasSnapshot => {
  const decoded = decodeCanvas(json)
  if (Either.isLeft(decoded)) throw new Error(decoded.left)
  return decoded.right
}

// The routes take the worktree root resolution as a function, so a test needs no
// session registry: "live" resolves to a real tmp tree, "rootless" to a session
// with no worktree, and anything else to an unknown session.
let root: string

const app = createApp((id) =>
  Promise.resolve(id === "live" ? root : id === "rootless" ? null : undefined),
)

const seededJsonCanvas = {
  nodes: [{ id: "n1", type: "text", x: 10, y: 20, width: 200, height: 60, text: "seeded" }],
  edges: [],
}

const seededLegacyCanvas = {
  version: 1,
  updatedAt: "2026-01-01T00:00:00.000Z",
  nodes: [{ id: "n1", position: { x: 10, y: 20 }, data: { label: "legacy" } }],
  edges: [],
}

// Native Excalidraw shape with keys the daemon has no schema for — the doc
// routes must relay them untouched.
const seededExcalidraw = {
  type: "excalidraw",
  version: 2,
  source: "https://excalidraw.com",
  elements: [{ id: "el1", type: "rectangle", x: 5, y: 6, customFutureKey: true }],
  appState: { viewBackgroundColor: "#fffce8" },
  files: {},
}

const seed = async (input: { readonly path: string; readonly body: unknown }): Promise<void> => {
  const abs = join(root, input.path)
  await mkdir(join(abs, ".."), { recursive: true })
  await writeFile(abs, JSON.stringify(input.body), "utf8")
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "brainstorms-routes-"))
  // Deliberately spread across the tree: a board is any *.canvas / *.canvas.json
  // / *.excalidraw file, not a file in one blessed directory.
  await seed({ path: "docs/arch.canvas", body: seededJsonCanvas })
  await seed({ path: "brainstorms/plan.canvas", body: { nodes: [], edges: [] } })
  await seed({ path: ".pid/brainstorms/legacy.canvas.json", body: seededLegacyCanvas })
  await seed({ path: "notes/sketch.excalidraw", body: seededExcalidraw })
  await writeFile(join(root, "README.md"), "not a board", "utf8")
})

afterAll(async () => {
  __resetCanvasRoomsForTests()
  __resetJsonCanvasRoomsForTests()
  __resetExcalidrawRoomsForTests()
  await rm(root, { recursive: true, force: true })
})

const post = (path: string, body: unknown) =>
  app.request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  })

const doc = (input: { readonly editor: string; readonly path: string }) =>
  `/live/brainstorms/${input.editor}?path=${encodeURIComponent(input.path)}`

describe("GET /:id/brainstorms (list)", () => {
  it("lists every board in the session's tree, ordered by path", async () => {
    const res = await app.request("/live/brainstorms")
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      path: string
      label: string
      kind: string
      file: string
      updatedAt: string
    }[]
    expect(body.map((b) => [b.path, b.kind])).toEqual([
      [".pid/brainstorms/legacy.canvas.json", "canvasJson"],
      ["brainstorms/plan.canvas", "canvas"],
      ["docs/arch.canvas", "canvas"],
      ["notes/sketch.excalidraw", "excalidraw"],
    ])
    expect(body.map((b) => b.label)).toEqual([
      ".pid/brainstorms/legacy",
      "plan",
      "docs/arch",
      "notes/sketch",
    ])
    expect(body[3]?.file).toBe(join(root, "notes", "sketch.excalidraw"))
    expect(Date.parse(body[0]?.updatedAt ?? "")).toBeGreaterThan(0)
  })

  it("404s an unknown session and a session with no worktree", async () => {
    expect((await app.request("/ghost/brainstorms")).status).toBe(404)
    expect((await app.request("/rootless/brainstorms")).status).toBe(404)
  })
})

describe("POST /:id/brainstorms (create)", () => {
  it("creates an empty .canvas board under brainstorms/ by default", async () => {
    const res = await post("/live/brainstorms", { name: "auth-flow" })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { path: string; kind: string; label: string; file: string }
    expect(body).toMatchObject({
      path: "brainstorms/auth-flow.canvas",
      kind: "canvas",
      label: "auth-flow",
    })
    expect(JSON.parse(await readFile(body.file, "utf8"))).toEqual({ nodes: [], edges: [] })

    // and it's now visible through the list route — no drift from discovery.
    const list = await app.request("/live/brainstorms")
    const paths = ((await list.json()) as { path: string }[]).map((b) => b.path)
    expect(paths).toContain("brainstorms/auth-flow.canvas")
  })

  it("creates a native Excalidraw board when kind is excalidraw", async () => {
    const res = await post("/live/brainstorms", { name: "fresh-sketch", kind: "excalidraw" })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { path: string; kind: string; file: string }
    expect(body.path).toBe("brainstorms/fresh-sketch.excalidraw")
    const onDisk = JSON.parse(await readFile(body.file, "utf8")) as { elements: unknown[] }
    expect(onDisk.elements).toEqual([])
  })

  it("400s a non-JSON or malformed body", async () => {
    expect((await post("/live/brainstorms", "{not json")).status).toBe(400)
    expect((await post("/live/brainstorms", [1])).status).toBe(400)
    expect((await post("/live/brainstorms", { name: 42 })).status).toBe(400)
  })

  it("400s an invalid name and an unknown kind", async () => {
    expect((await post("/live/brainstorms", { name: "Bad Name" })).status).toBe(400)
    expect((await post("/live/brainstorms", { name: "../escape" })).status).toBe(400)
    expect((await post("/live/brainstorms", { name: "x-kind", kind: "vsdx" })).status).toBe(400)
    // The legacy React-Flow encoding is readable but never creatable.
    expect((await post("/live/brainstorms", { name: "x-kind", kind: "canvasJson" })).status).toBe(
      400,
    )
  })

  it("409s a name already taken in any format", async () => {
    expect((await post("/live/brainstorms", { name: "plan" })).status).toBe(409)
    expect((await post("/live/brainstorms", { name: "plan", kind: "excalidraw" })).status).toBe(409)
  })

  it("404s creating in an unknown session", async () => {
    expect((await post("/ghost/brainstorms", { name: "nope" })).status).toBe(404)
  })
})

describe("GET /:id/brainstorms/canvas (snapshot)", () => {
  it("decodes an Obsidian .canvas board into the shared canvas wire shape", async () => {
    const res = await app.request(doc({ editor: "canvas", path: "docs/arch.canvas" }))
    expect(res.status).toBe(200)
    const snap = parseCanvas(await res.json())
    expect(snap.nodes[0]).toMatchObject({ id: "n1", position: { x: 10, y: 20 } })
    expect(snap.nodes[0]?.data).toEqual({ label: "seeded" })
  })

  it("serves a legacy .canvas.json board through the same route", async () => {
    const res = await app.request(
      doc({ editor: "canvas", path: ".pid/brainstorms/legacy.canvas.json" }),
    )
    expect(res.status).toBe(200)
    expect(parseCanvas(await res.json()).nodes[0]?.data).toEqual({ label: "legacy" })
  })

  it("404s a missing board, a non-board file and an excalidraw board", async () => {
    expect((await app.request(doc({ editor: "canvas", path: "ghost.canvas" }))).status).toBe(404)
    expect((await app.request(doc({ editor: "canvas", path: "README.md" }))).status).toBe(404)
    expect(
      (await app.request(doc({ editor: "canvas", path: "notes/sketch.excalidraw" }))).status,
    ).toBe(404)
  })

  it("403s a traversal-shaped path before touching the filesystem", async () => {
    expect((await app.request(doc({ editor: "canvas", path: "../secrets.canvas" }))).status).toBe(
      403,
    )
    expect((await app.request(doc({ editor: "canvas", path: "" }))).status).toBe(403)
  })
})

describe("POST /:id/brainstorms/canvas (publish)", () => {
  it("writes an Obsidian .canvas board back in its own format", async () => {
    const next = {
      version: 1,
      updatedAt: "2026-01-01T00:00:00.000Z",
      nodes: [
        {
          id: "n2",
          type: "box",
          position: { x: 1, y: 2 },
          data: { label: "published" },
          style: { width: 200, height: 60 },
        },
      ],
      edges: [],
    }
    const res = await post(doc({ editor: "canvas", path: "brainstorms/plan.canvas" }), next)
    expect(res.status).toBe(200)
    expect(parseCanvas(await res.json()).nodes[0]?.data).toEqual({ label: "published" })

    const onDisk = JSON.parse(
      await readFile(join(root, "brainstorms", "plan.canvas"), "utf8"),
    ) as Record<string, unknown>
    expect(Object.keys(onDisk).sort()).toEqual(["edges", "nodes"])
    expect(onDisk.nodes).toEqual([
      { id: "n2", type: "text", x: 1, y: 2, width: 200, height: 60, text: "published" },
    ])
  })

  it("400s a malformed snapshot", async () => {
    expect(
      (await post(doc({ editor: "canvas", path: "brainstorms/plan.canvas" }), "null")).status,
    ).toBe(400)
  })

  it("404s publishing to a board that does not exist", async () => {
    expect((await post(doc({ editor: "canvas", path: "ghost.canvas" }), {})).status).toBe(404)
  })
})

describe("GET/POST /:id/brainstorms/excalidraw (document)", () => {
  it("returns the native document untouched, unknown keys included", async () => {
    const res = await app.request(doc({ editor: "excalidraw", path: "notes/sketch.excalidraw" }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(seededExcalidraw)
  })

  it("persists byte-preserving — no foreign updatedAt stamping", async () => {
    const next = { ...seededExcalidraw, elements: [{ id: "el2", type: "ellipse" }] }
    const res = await post(doc({ editor: "excalidraw", path: "notes/sketch.excalidraw" }), next)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(next)
    expect(JSON.parse(await readFile(join(root, "notes", "sketch.excalidraw"), "utf8"))).toEqual(
      next,
    )
  })

  it("400s a malformed document", async () => {
    const path = doc({ editor: "excalidraw", path: "notes/sketch.excalidraw" })
    expect((await post(path, "null")).status).toBe(400)
    expect((await post(path, { type: "x" })).status).toBe(400)
  })

  it("404s a canvas board — the excalidraw routes serve only .excalidraw files", async () => {
    expect(
      (await app.request(doc({ editor: "excalidraw", path: "docs/arch.canvas" }))).status,
    ).toBe(404)
  })
})
