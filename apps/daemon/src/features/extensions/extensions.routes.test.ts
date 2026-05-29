import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { app } from "../../api"
import type { ExtensionManifest } from "../../platform/extensions/manifest"
import { extensionRegistry } from "../../platform/extensions/registry"

// Routes are exercised through the mounted api.ts `app` so the test also
// covers the /extensions mount + enriched GET /extensions listing.

const mk = (name: string): ExtensionManifest => ({
  name,
  version: "1.0.0",
  tier: "iframe",
  permissions: { fs: ["/secret"], events: true },
  contributes: { tabs: [{ id: "t" }] },
})

let stateDir: string

beforeEach(() => {
  extensionRegistry.clear()
  stateDir = mkdtempSync(join(tmpdir(), "pid-ext-state-"))
  process.env.PID_EXT_STATE_FILE = join(stateDir, "state.json")
})

afterEach(() => {
  extensionRegistry.clear()
  // biome-ignore lint/performance/noDelete: `process.env.X = undefined` coerces to the string "undefined" and would leak into sibling tests.
  delete process.env.PID_EXT_STATE_FILE
  try {
    rmSync(stateDir, { recursive: true, force: true })
  } catch {
    // ignore
  }
})

const post = (path: string, body?: unknown): Promise<Response> =>
  app.request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

const listEntry = async (name: string): Promise<Record<string, unknown> | undefined> => {
  const res = await app.request("/extensions")
  const body = (await res.json()) as Array<Record<string, unknown>>
  return body.find((e) => e.name === name)
}

describe("extension management routes", () => {
  it("GET /extensions enriches each entry with requested, granted, enabled", async () => {
    extensionRegistry.register({ manifest: mk("alpha"), dir: stateDir, scope: "local" })
    const entry = await listEntry("alpha")
    expect(entry?.requested).toEqual(["fs", "events"])
    expect(entry?.granted).toEqual([]) // nothing granted yet
    expect(entry?.enabled).toBe(true) // default-enabled
    // never leak raw permission values
    expect(JSON.stringify(entry)).not.toContain("/secret")
  })

  it("disable then enable persists and is reflected in GET /extensions", async () => {
    extensionRegistry.register({ manifest: mk("alpha"), dir: stateDir, scope: "local" })

    const dis = await post("/extensions/alpha/disable")
    expect(dis.status).toBe(200)
    expect((await dis.json()).enabled).toBe(false)
    expect((await listEntry("alpha"))?.enabled).toBe(false)

    const en = await post("/extensions/alpha/enable")
    expect(en.status).toBe(200)
    expect((await en.json()).enabled).toBe(true)
    expect((await listEntry("alpha"))?.enabled).toBe(true)
  })

  it("grants persist and appear as granted keys in GET /extensions", async () => {
    extensionRegistry.register({ manifest: mk("alpha"), dir: stateDir, scope: "local" })

    const res = await post("/extensions/alpha/grants", { fs: ["/data"], events: true })
    expect(res.status).toBe(200)
    const entry = await listEntry("alpha")
    expect((entry?.granted as string[]).sort()).toEqual(["events", "fs"])
  })

  it("404s for an unknown extension", async () => {
    expect((await post("/extensions/nope/enable")).status).toBe(404)
    expect((await post("/extensions/nope/grants", { fs: ["/x"] })).status).toBe(404)
  })

  it("400s for a malformed grants body", async () => {
    extensionRegistry.register({ manifest: mk("alpha"), dir: stateDir, scope: "local" })
    expect((await post("/extensions/alpha/grants", { fs: "not-an-array" })).status).toBe(400)
    expect((await post("/extensions/alpha/grants", { events: "yes" })).status).toBe(400)
    expect((await post("/extensions/alpha/grants", [1, 2, 3])).status).toBe(400)
  })
})
