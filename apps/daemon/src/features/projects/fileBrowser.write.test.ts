import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createAt, moveAt, removeAt } from "./fileBrowser.repo"

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "fb-write-"))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

const exists = async (rel: string): Promise<boolean> => {
  try {
    await stat(join(root, rel))
    return true
  } catch {
    return false
  }
}

describe("createAt", () => {
  it("creates an empty file under the root", async () => {
    const res = await createAt(root, { path: "notes/todo.md", kind: "file" })
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.value.path).toBe("notes/todo.md")
    expect(await exists("notes/todo.md")).toBe(true)
  })

  it("creates a directory under the root", async () => {
    const res = await createAt(root, { path: "src/components", kind: "directory" })
    expect(res.ok).toBe(true)
    const s = await stat(join(root, "src/components"))
    expect(s.isDirectory()).toBe(true)
  })

  it("refuses to overwrite an existing path", async () => {
    await writeFile(join(root, "a.txt"), "x")
    const res = await createAt(root, { path: "a.txt", kind: "file" })
    expect(res).toEqual({ ok: false, error: "exists" })
  })

  it("rejects path traversal", async () => {
    const res = await createAt(root, { path: "../escape.txt", kind: "file" })
    expect(res).toEqual({ ok: false, error: "forbidden" })
    expect(await exists("../escape.txt")).toBe(false)
  })

  it("rejects creating the root itself", async () => {
    const res = await createAt(root, { path: "", kind: "directory" })
    expect(res).toEqual({ ok: false, error: "forbidden" })
  })
})

describe("moveAt", () => {
  it("renames a file in place", async () => {
    await writeFile(join(root, "old.txt"), "hi")
    const res = await moveAt(root, { from: "old.txt", to: "new.txt" })
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.value).toEqual({ from: "old.txt", to: "new.txt" })
    expect(await exists("old.txt")).toBe(false)
    expect(await exists("new.txt")).toBe(true)
  })

  it("moves a file into a (created) subdirectory", async () => {
    await writeFile(join(root, "f.txt"), "hi")
    const res = await moveAt(root, { from: "f.txt", to: "deep/nested/f.txt" })
    expect(res.ok).toBe(true)
    expect(await exists("deep/nested/f.txt")).toBe(true)
  })

  it("fails when the source is missing", async () => {
    const res = await moveAt(root, { from: "ghost.txt", to: "x.txt" })
    expect(res).toEqual({ ok: false, error: "not_found" })
  })

  it("refuses to clobber an existing destination", async () => {
    await writeFile(join(root, "a.txt"), "a")
    await writeFile(join(root, "b.txt"), "b")
    const res = await moveAt(root, { from: "a.txt", to: "b.txt" })
    expect(res).toEqual({ ok: false, error: "exists" })
    expect(await exists("a.txt")).toBe(true)
  })

  it("rejects traversal on either endpoint", async () => {
    await writeFile(join(root, "a.txt"), "a")
    expect(await moveAt(root, { from: "a.txt", to: "../out.txt" })).toEqual({
      ok: false,
      error: "forbidden",
    })
    expect(await moveAt(root, { from: "../in.txt", to: "a2.txt" })).toEqual({
      ok: false,
      error: "forbidden",
    })
  })

  it("refuses to move a directory into its own descendant", async () => {
    await mkdir(join(root, "dir/sub"), { recursive: true })
    const res = await moveAt(root, { from: "dir", to: "dir/sub/dir" })
    expect(res).toEqual({ ok: false, error: "forbidden" })
  })
})

describe("removeAt", () => {
  it("removes a file", async () => {
    await writeFile(join(root, "a.txt"), "a")
    const res = await removeAt(root, { path: "a.txt", recursive: false })
    expect(res.ok).toBe(true)
    expect(await exists("a.txt")).toBe(false)
  })

  it("removes a directory recursively", async () => {
    await mkdir(join(root, "d/sub"), { recursive: true })
    await writeFile(join(root, "d/sub/x.txt"), "x")
    const res = await removeAt(root, { path: "d", recursive: true })
    expect(res.ok).toBe(true)
    expect(await exists("d")).toBe(false)
  })

  it("fails when the target is missing", async () => {
    const res = await removeAt(root, { path: "nope.txt", recursive: false })
    expect(res).toEqual({ ok: false, error: "not_found" })
  })

  it("rejects traversal", async () => {
    const res = await removeAt(root, { path: "../../etc/hosts", recursive: false })
    expect(res).toEqual({ ok: false, error: "forbidden" })
  })

  it("rejects removing the root itself", async () => {
    const res = await removeAt(root, { path: "", recursive: true })
    expect(res).toEqual({ ok: false, error: "forbidden" })
    expect((await readdir(root)).length >= 0).toBe(true)
  })
})
