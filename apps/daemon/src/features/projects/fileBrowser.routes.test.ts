import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { errorToStatus, runFsCreate, runFsDelete, runFsMove } from "./fileBrowser.routes"

describe("errorToStatus", () => {
  it("maps exists to 409 conflict", () => {
    expect(errorToStatus("exists")).toBe(409)
  })
  it("maps forbidden to 403 and missing to 404", () => {
    expect(errorToStatus("forbidden")).toBe(403)
    expect(errorToStatus("not_found")).toBe(404)
  })
})

describe("fs dispatchers", () => {
  let root: string
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "fb-routes-"))
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it("runFsCreate writes a file and returns 200 with the path", async () => {
    const res = await runFsCreate(root, { path: "x/y.txt", kind: "file" })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ path: "x/y.txt" })
    expect((await stat(join(root, "x/y.txt"))).isFile()).toBe(true)
  })

  it("runFsCreate rejects a missing path with 400", async () => {
    expect(await runFsCreate(root, {})).toEqual({ status: 400, body: { error: "missing_path" } })
  })

  it("runFsCreate surfaces a traversal attempt as 403 forbidden", async () => {
    expect(await runFsCreate(root, { path: "../evil", kind: "directory" })).toEqual({
      status: 403,
      body: { error: "forbidden" },
    })
  })

  it("runFsMove renames and returns from/to", async () => {
    await writeFile(join(root, "a.txt"), "a")
    expect(await runFsMove(root, { from: "a.txt", to: "b.txt" })).toEqual({
      status: 200,
      body: { from: "a.txt", to: "b.txt" },
    })
  })

  it("runFsMove maps an occupied destination to 409", async () => {
    await writeFile(join(root, "a.txt"), "a")
    await writeFile(join(root, "b.txt"), "b")
    expect(await runFsMove(root, { from: "a.txt", to: "b.txt" })).toEqual({
      status: 409,
      body: { error: "exists" },
    })
  })

  it("runFsMove requires both endpoints", async () => {
    expect(await runFsMove(root, { from: "a.txt" })).toEqual({
      status: 400,
      body: { error: "missing_path" },
    })
  })

  it("runFsDelete removes a directory only when recursive is true", async () => {
    const guarded = await runFsCreate(root, { path: "d/inner.txt", kind: "file" })
    expect(guarded.status).toBe(200)
    // non-recursive delete of a non-empty dir fails
    expect((await runFsDelete(root, { path: "d" })).status).toBe(400)
    // recursive delete succeeds
    expect((await runFsDelete(root, { path: "d", recursive: true })).status).toBe(200)
  })

  it("runFsDelete maps a missing target to 404", async () => {
    expect(await runFsDelete(root, { path: "ghost", recursive: false })).toEqual({
      status: 404,
      body: { error: "not_found" },
    })
  })
})
