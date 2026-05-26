import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { buildDropsApp } from "./drops.routes"

describe("POST /drops", () => {
  let appRoot: string

  beforeEach(() => {
    appRoot = mkdtempSync(join(tmpdir(), "pid-drops-"))
  })

  afterEach(() => {
    rmSync(appRoot, { recursive: true, force: true })
  })

  it("saves uploaded files under <appRoot>/drops/ and returns their absolute path", async () => {
    const app = buildDropsApp({ resolveAppRoot: () => appRoot })

    const fd = new FormData()
    fd.append("files", new File(["hello"], "hello.txt"))
    fd.append("activeProjectId", "p1")

    const res = await app.request("/", { method: "POST", body: fd })
    expect(res.status).toBe(200)

    const json = (await res.json()) as {
      files: ReadonlyArray<{ name: string; path: string; size: number }>
    }
    expect(json.files).toHaveLength(1)
    const file = json.files[0]
    expect(file?.name).toBe("hello.txt")
    expect(file?.size).toBe(5)
    expect(file?.path.startsWith(`${join(appRoot, "drops")}/`)).toBe(true)
    expect(existsSync(file?.path ?? "")).toBe(true)
    expect(readFileSync(file?.path ?? "", "utf-8")).toBe("hello")
  })

  it("rejects a request without activeProjectId with 400 no active project", async () => {
    const app = buildDropsApp({ resolveAppRoot: () => appRoot })
    const fd = new FormData()
    fd.append("files", new File(["x"], "x.txt"))
    const res = await app.request("/", { method: "POST", body: fd })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: "no active project" })
  })
})
