import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { buildStaticApp } from "./static-web.routes"

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pid-static-web-"))
  writeFileSync(join(dir, "index.html"), "<h1>pid-dashboard</h1>")
  mkdirSync(join(dir, "assets"), { recursive: true })
  writeFileSync(join(dir, "assets", "app.js"), "export const x = 1")
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe("buildStaticApp", () => {
  it("serves index.html at the root", async () => {
    const app = buildStaticApp(dir)
    const res = await app.request("/")
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type") ?? "").toContain("text/html")
    expect(await res.text()).toBe("<h1>pid-dashboard</h1>")
  })

  it("serves a nested asset with the right content-type", async () => {
    const app = buildStaticApp(dir)
    const res = await app.request("/assets/app.js")
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type") ?? "").toContain("javascript")
    expect(await res.text()).toBe("export const x = 1")
  })

  it("falls back to index.html for an unknown extensionless SPA route", async () => {
    const app = buildStaticApp(dir)
    const res = await app.request("/sessions/abc123")
    expect(res.status).toBe(200)
    expect(await res.text()).toBe("<h1>pid-dashboard</h1>")
  })

  it("404s for a missing asset with a real extension", async () => {
    const app = buildStaticApp(dir)
    const res = await app.request("/assets/missing.js")
    expect(res.status).toBe(404)
  })

  it("rejects path traversal and never escapes the static root", async () => {
    const secret = join(dir, "..", "secret.txt")
    writeFileSync(secret, "TOPSECRET")
    try {
      const app = buildStaticApp(dir)
      const res = await app.request("/../secret.txt")
      expect([400, 404].includes(res.status)).toBe(true)
      if (res.status === 200) {
        expect(await res.text()).not.toContain("TOPSECRET")
      }
    } finally {
      rmSync(secret, { force: true })
    }
  })

  it("rejects encoded traversal", async () => {
    const app = buildStaticApp(dir)
    const res = await app.request("/%2e%2e%2fsecret.txt")
    expect([400, 404].includes(res.status)).toBe(true)
  })
})
