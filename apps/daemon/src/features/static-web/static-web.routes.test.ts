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

/**
 * The behaviour change from folding this slice's own 16-entry table into
 * `platform/http-content.core`'s 44-entry one. Asserted rather than left
 * incidental: these responses carry `X-Content-Type-Options: nosniff`, so a
 * content type is load-bearing — a browser that is told `application/octet-stream`
 * will not render the asset, whatever the bytes say.
 *
 * The old table kept `woff`/`woff2`/`map` and the wide one did not, so the fold
 * added them there rather than dropping them here; the first case below is what
 * would have regressed.
 */
describe("buildStaticApp content types after the MIME consolidation", () => {
  const served = async (rel: string): Promise<string> => {
    mkdirSync(join(dir, "assets"), { recursive: true })
    writeFileSync(join(dir, rel), "x")
    const res = await buildStaticApp(dir).request(`/${rel}`)
    expect(res.status).toBe(200)
    return res.headers.get("content-type") ?? ""
  }

  it("still serves webfonts and sourcemaps — the entries the wide table lacked", async () => {
    expect(await served("assets/inter.woff2")).toBe("font/woff2")
    expect(await served("assets/legacy.woff")).toBe("font/woff")
    expect(await served("assets/app.js.map")).toBe("application/json; charset=utf-8")
  })

  it("now types extensions it used to answer octet-stream for", async () => {
    expect(await served("assets/hero.avif")).toBe("image/avif")
    expect(await served("assets/demo.mp4")).toBe("video/mp4")
    expect(await served("assets/chime.mp3")).toBe("audio/mpeg")
    expect(await served("assets/guide.pdf")).toBe("application/pdf")
    expect(await served("assets/data.csv")).toBe("text/csv; charset=utf-8")
    expect(await served("assets/README.md")).toBe("text/markdown; charset=utf-8")
  })

  it("serves .ico as the IANA type, not the legacy image/x-icon it used to send", async () => {
    expect(await served("favicon.ico")).toBe("image/vnd.microsoft.icon")
  })

  it("still defaults to octet-stream for an extension no table knows", async () => {
    expect(await served("assets/weird.unknownext")).toBe("application/octet-stream")
  })

  /**
   * The deleted `staticMime` split the extension with `extname()`; `mimeFromPath`
   * uses the last `.` in the string. They agree on every input except a filename
   * that is *only* an extension (`.html`), where `extname` returns "" and
   * `lastIndexOf` returns "html". Unreachable here rather than merely unlikely:
   * `resolveStaticRel` runs first and rewrites any extname-less path to
   * index.html, so the one divergent input never reaches the MIME lookup. Pinned,
   * because "the parse changed but no caller can observe it" is a claim that
   * should fail loudly if `resolveStaticRel` ever stops rewriting.
   */
  it("routes a bare-dotfile path to index.html before any MIME lookup happens", async () => {
    const res = await buildStaticApp(dir).request("/.html")
    expect(res.status).toBe(200)
    expect(await res.text()).toBe("<h1>pid-dashboard</h1>")
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8")
  })
})
