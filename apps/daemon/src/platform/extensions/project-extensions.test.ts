import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ExtensionManifest } from "./manifest"
import { clearProjectExtensionsCache, resolveProjectExtensions } from "./project-extensions"

const writeExt = (
  projectPath: string,
  name: string,
  manifest: Partial<ExtensionManifest> & { name: string },
): void => {
  const dir = join(projectPath, ".pid", "extensions", name)
  mkdirSync(dir, { recursive: true })
  const full: Record<string, unknown> = { version: "1.0.0", tier: "iframe", ...manifest }
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(full))
  writeFileSync(join(dir, "index.html"), "<!doctype html><title>ok</title>")
}

const writeState = (projectPath: string, state: unknown): void => {
  mkdirSync(join(projectPath, ".pid"), { recursive: true })
  writeFileSync(join(projectPath, ".pid", "extensions-state.json"), JSON.stringify(state))
}

let projA: string
let projB: string
const cleanups: string[] = []

beforeEach(() => {
  clearProjectExtensionsCache()
  projA = mkdtempSync(join(tmpdir(), "pid-projA-"))
  projB = mkdtempSync(join(tmpdir(), "pid-projB-"))
  cleanups.push(projA, projB)
})

afterEach(() => {
  for (const d of cleanups.splice(0)) {
    try {
      rmSync(d, { recursive: true, force: true })
    } catch {
      // ignore
    }
  }
})

describe("resolveProjectExtensions", () => {
  it("discovers a project's local iframe extension", async () => {
    writeExt(projA, "repo-explorer", { name: "repo-explorer" })
    const exts = await resolveProjectExtensions(projA, { now: 1 })
    expect(exts.map((e) => e.manifest.name)).toEqual(["repo-explorer"])
    expect(exts[0]?.scope).toBe("local")
    expect(exts[0]?.dir).toBe(join(projA, ".pid", "extensions", "repo-explorer"))
  })

  it("isolates extensions per project — A's panel never appears for B", async () => {
    writeExt(projA, "repo-explorer", { name: "repo-explorer" })
    // projB has no extensions installed.
    expect((await resolveProjectExtensions(projA, { now: 1 })).length).toBe(1)
    expect((await resolveProjectExtensions(projB, { now: 1 })).length).toBe(0)
  })

  it("honors the project's own state file (disabled => not returned)", async () => {
    writeExt(projA, "repo-explorer", { name: "repo-explorer" })
    writeState(projA, { "repo-explorer": { enabled: false, grants: {} } })
    expect((await resolveProjectExtensions(projA, { now: 1 })).length).toBe(0)
  })

  it("caches within the TTL and re-scans after it expires", async () => {
    writeExt(projA, "one", { name: "one" })
    const first = await resolveProjectExtensions(projA, { now: 1000 })
    expect(first.map((e) => e.manifest.name)).toEqual(["one"])

    // Install a second ext, but a request inside the TTL still sees the cache.
    writeExt(projA, "two", { name: "two" })
    const cached = await resolveProjectExtensions(projA, { now: 1000 + 2_000 })
    expect(cached.map((e) => e.manifest.name)).toEqual(["one"])

    // After the TTL the directory is re-scanned and the new ext appears.
    const fresh = await resolveProjectExtensions(projA, { now: 1000 + 4_000 })
    expect(fresh.map((e) => e.manifest.name).sort()).toEqual(["one", "two"])
  })
})
