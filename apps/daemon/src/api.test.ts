import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { app } from "./api"
import type { ExtensionManifest } from "./platform/extensions/manifest"
import { clearProjectExtensionsCache } from "./platform/extensions/project-extensions"
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

describe("GET /extensions?projectId (per-project local scoping)", () => {
  let projectsRoot: string
  let savedRoot: string | undefined

  const installLocal = (projectId: string, name: string): string => {
    const extDir = join(projectsRoot, projectId, ".pid", "extensions", name)
    mkdirSync(extDir, { recursive: true })
    writeFileSync(
      join(extDir, "manifest.json"),
      JSON.stringify({ name, version: "0.1.0", tier: "iframe" }),
    )
    writeFileSync(join(extDir, "index.html"), `<title>${name}</title>`)
    return extDir
  }

  beforeEach(() => {
    clearProjectExtensionsCache()
    projectsRoot = mkdtempSync(join(tmpdir(), "pid-proots-"))
    savedRoot = process.env.PID_PROJECTS_ROOT
    process.env.PID_PROJECTS_ROOT = projectsRoot
  })

  afterEach(() => {
    clearProjectExtensionsCache()
    if (savedRoot === undefined) Reflect.deleteProperty(process.env, "PID_PROJECTS_ROOT")
    else process.env.PID_PROJECTS_ROOT = savedRoot
    try {
      rmSync(projectsRoot, { recursive: true, force: true })
    } catch {
      // ignore
    }
  })

  it("includes a project's local extension only when its projectId is passed", async () => {
    installLocal("proj-a", "repo-explorer")

    const scoped = (await (await app.request("/extensions?projectId=proj-a")).json()) as Array<
      Record<string, unknown>
    >
    expect(scoped.map((e) => e.name)).toContain("repo-explorer")
    expect(scoped.find((e) => e.name === "repo-explorer")?.scope).toBe("local")

    // No projectId → globals only → the local panel must NOT appear.
    const unscoped = (await (await app.request("/extensions")).json()) as Array<
      Record<string, unknown>
    >
    expect(unscoped.map((e) => e.name)).not.toContain("repo-explorer")
  })

  it("does not leak project A's local extension into project B", async () => {
    installLocal("proj-a", "repo-explorer")
    const forB = (await (await app.request("/extensions?projectId=proj-b")).json()) as Array<
      Record<string, unknown>
    >
    expect(forB.map((e) => e.name)).not.toContain("repo-explorer")
  })

  it("serves a project-local extension's assets when ?projectId is given", async () => {
    installLocal("proj-a", "repo-explorer")
    const ok = await app.request("/extensions/repo-explorer/index.html?projectId=proj-a")
    expect(ok.status).toBe(200)
    expect(await ok.text()).toBe("<title>repo-explorer</title>")

    // Without projectId the local asset is unreachable (404).
    const missing = await app.request("/extensions/repo-explorer/index.html")
    expect(missing.status).toBe(404)
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
