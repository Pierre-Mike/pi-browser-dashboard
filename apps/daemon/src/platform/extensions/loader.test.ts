import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Hono } from "hono"
import type { ExtensionApi } from "./api"
import { loadExtensions } from "./loader"
import type { ExtensionManifest } from "./manifest"
import { createRegistry } from "./registry"

type Roots = { global: string; local: string }

const makeRoots = (): Roots => ({
  global: mkdtempSync(join(tmpdir(), "pid-ext-g-")),
  local: mkdtempSync(join(tmpdir(), "pid-ext-l-")),
})

const writeExt = (
  root: string,
  name: string,
  manifest: Partial<ExtensionManifest> & { name: string },
): string => {
  const dir = join(root, name)
  mkdirSync(dir, { recursive: true })
  const full: Record<string, unknown> = {
    version: "1.0.0",
    tier: "esm",
    ...manifest,
  }
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(full))
  // The loader only imports a daemon entry when one exists on disk (or is
  // explicitly declared). These fixtures exercise the daemon-side path via the
  // fake importer, so drop a stub daemon.ts to make the entry "present".
  writeFileSync(join(dir, "daemon.ts"), "export default () => {}\n")
  return dir
}

let roots: Roots
const cleanups: string[] = []

beforeEach(() => {
  roots = makeRoots()
  cleanups.push(roots.global, roots.local)
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

// A fake importer maps a daemonEntry abs path to a module whose default
// registers a /ping route returning the ext name.
const pingModule = (label: string) => ({
  default: (api: ExtensionApi) => {
    const sub = new Hono().get("/ping", (c) => c.text(label))
    api.registerRoute("", sub)
  },
})

describe("loadExtensions", () => {
  it("(a) loads a granted ext, mounts its route reachable via mountExtensions", async () => {
    const dir = writeExt(roots.global, "alpha", { name: "alpha" })
    const registry = createRegistry()
    const importer = async (abs: string) => {
      expect(abs).toBe(join(dir, "daemon.ts"))
      return pingModule("alpha-ok")
    }
    const res = await loadExtensions({
      roots,
      registry,
      granted: {},
      importer,
    })
    expect(res.loaded).toEqual(["alpha"])
    expect(res.skipped).toEqual([])

    const app = new Hono()
    for (const m of registry.mounts()) app.route(m.basePath, m.app)
    const r = await app.request("/ext/alpha/ping")
    expect(r.status).toBe(200)
    expect(await r.text()).toBe("alpha-ok")
  })

  it("(b) skips an ext requesting an un-granted permission", async () => {
    writeExt(roots.global, "needy", {
      name: "needy",
      permissions: { exec: ["rm"] },
    })
    const registry = createRegistry()
    const res = await loadExtensions({
      roots,
      registry,
      granted: {},
      importer: async () => pingModule("never"),
    })
    expect(res.loaded).not.toContain("needy")
    const skip = res.skipped.find((s) => s.name === "needy")
    expect(skip).toBeDefined()
    expect(skip?.reason).toContain("exec:rm")
    expect(registry.get("needy")).toBeUndefined()
  })

  it("(c) local same-name overrides global (dir + version win)", async () => {
    const gdir = writeExt(roots.global, "dup", { name: "dup", version: "1.0.0" })
    const ldir = writeExt(roots.local, "dup", { name: "dup", version: "2.0.0" })
    const registry = createRegistry()
    const importer = async (abs: string) => {
      if (abs.startsWith(gdir)) return pingModule("global")
      if (abs.startsWith(ldir)) return pingModule("local")
      throw new Error(`unexpected ${abs}`)
    }
    const res = await loadExtensions({ roots, registry, granted: {}, importer })
    expect(res.loaded).toEqual(["dup"])
    const got = registry.get("dup")
    expect(got?.scope).toBe("local")
    expect(got?.dir).toBe(ldir)
    expect(got?.manifest.version).toBe("2.0.0")
  })

  it("(d) a throwing importer does not crash the loader; others still load", async () => {
    const aDir = writeExt(roots.global, "good", { name: "good" })
    writeExt(roots.global, "bad", { name: "bad" })
    const registry = createRegistry()
    const importer = async (abs: string) => {
      if (abs.startsWith(aDir)) return pingModule("good")
      throw new Error("boom")
    }
    const res = await loadExtensions({ roots, registry, granted: {}, importer })
    expect(res.loaded).toContain("good")
    expect(res.loaded).not.toContain("bad")
    const skip = res.skipped.find((s) => s.name === "bad")
    expect(skip?.reason).toContain("boom")
  })

  it("(e) an invalid manifest.json is skipped without affecting others", async () => {
    const okDir = writeExt(roots.global, "okext", { name: "okext" })
    // invalid: bad name
    const badDir = join(roots.global, "weird")
    mkdirSync(badDir, { recursive: true })
    writeFileSync(join(badDir, "manifest.json"), JSON.stringify({ name: "Bad/Name", tier: "esm" }))
    const registry = createRegistry()
    const importer = async (abs: string) => {
      expect(abs.startsWith(okDir)).toBe(true)
      return pingModule("okext")
    }
    const res = await loadExtensions({ roots, registry, granted: {}, importer })
    expect(res.loaded).toEqual(["okext"])
    expect(res.skipped.length).toBe(1)
    expect(res.skipped[0]?.reason.length).toBeGreaterThan(0)
  })

  it("(f) registers a UI-only ext with no daemon entry (iframe tier) without skipping", async () => {
    // No daemon.ts on disk and no declared daemonEntry → UI-only extension.
    const dir = join(roots.local, "ui-only")
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, "manifest.json"),
      JSON.stringify({ name: "ui-only", version: "1.0.0", tier: "iframe" }),
    )
    const registry = createRegistry()
    let imported = false
    const res = await loadExtensions({
      roots,
      registry,
      granted: {},
      importer: async () => {
        imported = true
        return {}
      },
    })
    expect(imported).toBe(false) // never tried to import a non-existent entry
    expect(res.loaded).toEqual(["ui-only"])
    expect(res.skipped).toEqual([])
    // Registered so it lists + serves static assets, but contributes no route.
    expect(registry.get("ui-only")?.dir).toBe(dir)
    expect(registry.mounts().some((m) => m.basePath === "/ext/ui-only")).toBe(false)
  })

  it("ignores subdirs without a manifest.json", async () => {
    mkdirSync(join(roots.global, "empty"), { recursive: true })
    writeExt(roots.global, "real", { name: "real" })
    const registry = createRegistry()
    const res = await loadExtensions({
      roots,
      registry,
      granted: {},
      importer: async () => pingModule("real"),
    })
    expect(res.loaded).toEqual(["real"])
  })

  it("tolerates a missing root directory", async () => {
    const registry = createRegistry()
    const res = await loadExtensions({
      roots: { global: join(tmpdir(), "does-not-exist-xyz"), local: roots.local },
      registry,
      granted: {},
      importer: async () => pingModule("x"),
    })
    expect(res.loaded).toEqual([])
  })
})
