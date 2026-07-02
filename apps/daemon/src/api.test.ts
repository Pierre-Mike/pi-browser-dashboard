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
