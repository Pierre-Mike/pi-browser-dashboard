import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { app, buildApp } from "./api"
import type { ExtensionManifest } from "./platform/extensions/manifest"
import { extensionRegistry } from "./platform/extensions/registry"

const mk = (name: string): ExtensionManifest => ({
  name,
  version: "1.2.3",
  tier: "iframe",
  daemonEntry: "daemon.ts",
  permissions: { fs: ["/secret/path"], events: true },
  contributes: { tabs: [{ id: "t" }] },
})

let dir: string

beforeEach(() => {
  extensionRegistry.clear()
  dir = mkdtempSync(join(tmpdir(), "pid-api-ext-"))
})

afterEach(() => {
  extensionRegistry.clear()
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    // ignore
  }
})

describe("GET /extensions", () => {
  it("returns the sanitized manifest list with scope and no permission values", async () => {
    extensionRegistry.register({ manifest: mk("alpha"), dir, scope: "local" })
    const res = await app.request("/extensions")
    expect(res.status).toBe(200)
    const body = (await res.json()) as Array<Record<string, unknown>>
    expect(body.length).toBe(1)
    expect(body[0]?.name).toBe("alpha")
    expect(body[0]?.scope).toBe("local")
    expect(body[0]?.tier).toBe("iframe")
    // permissions are a key summary, not raw values
    expect(body[0]?.permissions).toEqual(["fs", "events"])
    expect(JSON.stringify(body)).not.toContain("/secret/path")
  })
})

describe("GET /extensions/:name/* (static assets)", () => {
  it("serves a file under the ext dir with the right content-type", async () => {
    writeFileSync(join(dir, "index.html"), "<h1>hi</h1>")
    extensionRegistry.register({ manifest: mk("ui"), dir, scope: "global" })
    const res = await app.request("/extensions/ui/index.html")
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type") ?? "").toContain("text/html")
    expect(await res.text()).toBe("<h1>hi</h1>")
  })

  it("serves nested js with javascript content-type", async () => {
    mkdirSync(join(dir, "assets"), { recursive: true })
    writeFileSync(join(dir, "assets", "app.js"), "export const x = 1")
    extensionRegistry.register({ manifest: mk("jsext"), dir, scope: "global" })
    const res = await app.request("/extensions/jsext/assets/app.js")
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type") ?? "").toContain("javascript")
  })

  it("404s for an unknown extension", async () => {
    const res = await app.request("/extensions/nope/index.html")
    expect(res.status).toBe(404)
  })

  it("404s for a missing file in a known extension", async () => {
    extensionRegistry.register({ manifest: mk("known"), dir, scope: "global" })
    const res = await app.request("/extensions/known/missing.html")
    expect(res.status).toBe(404)
  })

  it("rejects path traversal with .. and never escapes the dir", async () => {
    // place a secret one level above the ext dir
    const secret = join(dir, "..", "secret.txt")
    writeFileSync(secret, "TOPSECRET")
    extensionRegistry.register({ manifest: mk("trav"), dir, scope: "global" })
    try {
      const res = await app.request("/extensions/trav/../secret.txt")
      expect([400, 404].includes(res.status)).toBe(true)
      if (res.status === 200) {
        expect(await res.text()).not.toContain("TOPSECRET")
      }
    } finally {
      rmSync(secret, { force: true })
    }
  })

  it("rejects encoded traversal", async () => {
    extensionRegistry.register({ manifest: mk("trav2"), dir, scope: "global" })
    const res = await app.request("/extensions/trav2/%2e%2e%2fsecret.txt")
    expect([400, 404].includes(res.status)).toBe(true)
  })
})

/**
 * The behaviour change from deleting this file's own 14-entry `EXT_MIME_BY_EXT`
 * in favour of `platform/http-content.core`'s `mimeFromPath`. The extension
 * asset route sends `X-Content-Type-Options: nosniff`, so an iframe-tier
 * extension shipping a font or a video was previously served
 * `application/octet-stream` and the browser refused to use it.
 *
 * `woff`/`woff2`/`map` were in the deleted table and not in the wide one; the
 * fold added them there, and the first case below is what would otherwise have
 * regressed.
 */
describe("GET /extensions/:name/* content types after the MIME consolidation", () => {
  const served = async (rel: string): Promise<string> => {
    mkdirSync(join(dir, "assets"), { recursive: true })
    writeFileSync(join(dir, rel), "x")
    extensionRegistry.register({ manifest: mk("mimeext"), dir, scope: "global" })
    const res = await app.request(`/extensions/mimeext/${rel}`)
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
    expect(await served("assets/panel.tsx")).toBe("text/typescript; charset=utf-8")
    expect(await served("assets/notes.txt")).toBe("text/plain; charset=utf-8")
    expect(await served("assets/config.yaml")).toBe("application/yaml; charset=utf-8")
    expect(await served("assets/favicon.ico")).toBe("image/vnd.microsoft.icon")
  })

  it("still defaults to octet-stream for an extension no table knows", async () => {
    expect(await served("assets/weird.unknownext")).toBe("application/octet-stream")
  })
})

describe("file-drop surface", () => {
  // One endpoint saves dropped files, not two. `POST /drops` was the earlier
  // draft; /uploads is what the SPA calls (DropZone → handleDrop → uploadFile).
  // Pin it so re-adding a second path has to be a deliberate, reviewed act.
  it("mounts /uploads and nothing at /drops", async () => {
    const drops = await app.request("/drops", { method: "POST" })
    expect(drops.status).toBe(404)

    // /uploads is mounted: it rejects a non-multipart body rather than 404ing.
    const uploads = await app.request("/uploads", { method: "POST" })
    expect(uploads.status).toBe(400)
    expect(await uploads.json()).toEqual({ error: "invalid_body" })
  })
})

describe("GET /rules — mounted and off by default", () => {
  it("reports the disabled shape with no rules.json present", async () => {
    const res = await app.request("/rules")
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      enabled: false,
      paused: false,
      errors: [],
      rules: [],
      log: [],
    })
  })
})

describe("GET /agent-skill.md", () => {
  it("serves the agent skill doc as markdown with substantive content", async () => {
    const res = await app.request("/agent-skill.md")
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type") ?? "").toContain("text/markdown")
    const body = await res.text()
    expect(body).toContain("pid wait")
    expect(body).toContain("occupant_changed")
    expect(body).toContain("GET /sessions/:id/explain")
  })
})

describe("buildApp", () => {
  it("without a staticDir, mirrors today's shape: API at the bare root AND under /__api", async () => {
    const wrapped = buildApp()
    const bare = await wrapped.request("/health")
    expect(bare.status).toBe(200)
    expect(await bare.json()).toEqual({ ok: true })
    const prefixed = await wrapped.request("/__api/health")
    expect(prefixed.status).toBe(200)
    expect(await prefixed.json()).toEqual({ ok: true })
  })

  it("with a staticDir, moves the API behind /__api and serves the SPA at the bare root", async () => {
    const webDir = mkdtempSync(join(tmpdir(), "pid-buildapp-web-"))
    writeFileSync(join(webDir, "index.html"), "<h1>spa</h1>")
    try {
      const wrapped = buildApp(webDir)
      const spa = await wrapped.request("/")
      expect(spa.status).toBe(200)
      expect(await spa.text()).toBe("<h1>spa</h1>")

      // A path that is ALSO a real API route (GET /health) resolves to the SPA
      // shell at the bare root — this is the whole point of the prefix switch.
      const shadowed = await wrapped.request("/health")
      expect(shadowed.status).toBe(200)
      expect(await shadowed.text()).toBe("<h1>spa</h1>")

      const api = await wrapped.request("/__api/health")
      expect(api.status).toBe(200)
      expect(await api.json()).toEqual({ ok: true })
    } finally {
      rmSync(webDir, { recursive: true, force: true })
    }
  })

  it("with a staticDir, still serves SSE unprefixed at /events", async () => {
    const webDir = mkdtempSync(join(tmpdir(), "pid-buildapp-web-"))
    writeFileSync(join(webDir, "index.html"), "<h1>spa</h1>")
    try {
      const wrapped = buildApp(webDir)
      const res = await wrapped.request("/events")
      expect(res.status).toBe(200)
      expect(res.headers.get("content-type") ?? "").toContain("text/event-stream")
      await res.body?.cancel()
    } finally {
      rmSync(webDir, { recursive: true, force: true })
    }
  })
})
