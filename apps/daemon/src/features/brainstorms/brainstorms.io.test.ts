import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createBrainstormIn, listBrainstormsIn, resolveBrainstormIn } from "./brainstorms.io"

// Real filesystem: discovery is the whole point of this module, and a fake tree
// would not prove that a board outside brainstorms/ is found.
let root = ""

const seed = async (input: { readonly path: string; readonly body?: string }): Promise<void> => {
  const abs = join(root, input.path)
  await mkdir(join(abs, ".."), { recursive: true })
  await writeFile(abs, input.body ?? '{"nodes":[],"edges":[]}', "utf8")
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "pid-brainstorms-"))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe("listBrainstormsIn", () => {
  it("finds boards anywhere in the tree, in every format", async () => {
    await seed({ path: "brainstorms/auth.canvas" })
    await seed({ path: "docs/arch.canvas" })
    await seed({ path: ".pid/brainstorms/legacy.canvas.json" })
    await seed({ path: "notes/sketch.excalidraw", body: '{"elements":[]}' })
    await seed({ path: "README.md", body: "# not a board" })

    const boards = await listBrainstormsIn(root)
    expect(boards.map((b) => b.path)).toEqual([
      ".pid/brainstorms/legacy.canvas.json",
      "brainstorms/auth.canvas",
      "docs/arch.canvas",
      "notes/sketch.excalidraw",
    ])
    expect(boards.map((b) => b.kind)).toEqual(["canvasJson", "canvas", "canvas", "excalidraw"])
  })

  it("reports each board's absolute file and a real mtime", async () => {
    await seed({ path: "brainstorms/auth.canvas" })
    const boards = await listBrainstormsIn(root)
    expect(boards).toHaveLength(1)
    const [board] = boards as [(typeof boards)[number]]
    expect(board.file).toBe(join(root, "brainstorms/auth.canvas"))
    expect(board.label).toBe("auth")
    expect(Number.isNaN(Date.parse(board.updatedAt))).toBe(false)
  })

  it("is empty — never an error — for a tree with no boards or no root", async () => {
    expect(await listBrainstormsIn(root)).toEqual([])
    expect(await listBrainstormsIn(join(root, "nope"))).toEqual([])
  })
})

describe("createBrainstormIn", () => {
  it("lands a new canvas board in brainstorms/ as an empty .canvas document", async () => {
    const res = await createBrainstormIn({ root, name: "auth", kind: "canvas" })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.value.path).toBe("brainstorms/auth.canvas")
    expect(JSON.parse(await Bun.file(res.value.file).text())).toEqual({ nodes: [], edges: [] })
    expect((await listBrainstormsIn(root)).map((b) => b.path)).toEqual(["brainstorms/auth.canvas"])
  })

  it("creates an excalidraw board in its native format", async () => {
    const res = await createBrainstormIn({ root, name: "sketch", kind: "excalidraw" })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.value.path).toBe("brainstorms/sketch.excalidraw")
    expect(JSON.parse(await Bun.file(res.value.file).text())).toMatchObject({ elements: [] })
  })

  it("refuses a name already taken in any format", async () => {
    await seed({ path: "brainstorms/auth.excalidraw", body: '{"elements":[]}' })
    const res = await createBrainstormIn({ root, name: "auth", kind: "canvas" })
    expect(res).toEqual({ ok: false, error: "already_exists" })
  })

  it("refuses a name that is not a safe path segment", async () => {
    for (const name of ["../escape", "a/b", "Bad Name", ""]) {
      expect(await createBrainstormIn({ root, name, kind: "canvas" })).toEqual({
        ok: false,
        error: "invalid_name",
      })
    }
  })
})

describe("resolveBrainstormIn", () => {
  it("resolves an existing board to its absolute file and format", async () => {
    await seed({ path: "docs/arch.canvas" })
    const res = await resolveBrainstormIn({ root, path: "docs/arch.canvas" })
    expect(res).toEqual({
      ok: true,
      value: {
        path: "docs/arch.canvas",
        label: "docs/arch",
        kind: "canvas",
        file: join(root, "docs/arch.canvas"),
      },
    })
  })

  it("is not_found for a missing board and for a file that is not a board", async () => {
    await seed({ path: "README.md", body: "x" })
    expect(await resolveBrainstormIn({ root, path: "nope.canvas" })).toEqual({
      ok: false,
      error: "not_found",
    })
    expect(await resolveBrainstormIn({ root, path: "README.md" })).toEqual({
      ok: false,
      error: "not_found",
    })
  })

  it("refuses traversal out of the root", async () => {
    for (const path of ["../outside.canvas", "/etc/passwd.canvas", ""]) {
      expect(await resolveBrainstormIn({ root, path })).toEqual({ ok: false, error: "forbidden" })
    }
  })
})
