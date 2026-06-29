import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { Hono } from "hono"
import type { ExtensionApi } from "./api"
import { findProjectRoot, loadExtensions } from "./loader"
import type { ExtensionManifest } from "./manifest"
import { createRegistry } from "./registry"
import { writeState } from "./state"

type Roots = { global: string; local: string }

const makeRoots = (): Roots => ({
  global: mkdtempSync(join(tmpdir(), "pid-ext-g-")),
  local: mkdtempSync(join(tmpdir(), "pid-ext-l-")),
})

const writeExt = ({
  root,
  name,
  manifest,
}: {
  root: string
  name: string
  manifest: Partial<ExtensionManifest> & { name: string }
}): string => {
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
    const dir = writeExt({ root: roots.global, name: "alpha", manifest: { name: "alpha" } })
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
    writeExt({
      root: roots.global,
      name: "needy",
      manifest: {
        name: "needy",
        permissions: { exec: ["rm"] },
      },
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
    const gdir = writeExt({
      root: roots.global,
      name: "dup",
      manifest: { name: "dup", version: "1.0.0" },
    })
    const ldir = writeExt({
      root: roots.local,
      name: "dup",
      manifest: { name: "dup", version: "2.0.0" },
    })
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
    const aDir = writeExt({ root: roots.global, name: "good", manifest: { name: "good" } })
    writeExt({ root: roots.global, name: "bad", manifest: { name: "bad" } })
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
    const okDir = writeExt({ root: roots.global, name: "okext", manifest: { name: "okext" } })
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
    writeExt({ root: roots.global, name: "real", manifest: { name: "real" } })
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

  it("(g) disabled ext in state is not loaded or registered", async () => {
    writeExt({ root: roots.global, name: "disabled-ext", manifest: { name: "disabled-ext" } })
    const registry = createRegistry()
    const stateFile = join(tmpdir(), `pid-loader-state-${Math.random().toString(36).slice(2)}.json`)
    writeState(stateFile, { "disabled-ext": { enabled: false, grants: {} } })
    try {
      const res = await loadExtensions({
        roots,
        registry,
        granted: {},
        importer: async () => pingModule("should-not-load"),
        stateFile,
      })
      expect(res.loaded).not.toContain("disabled-ext")
      const skip = res.skipped.find((s) => s.name === "disabled-ext")
      expect(skip).toBeDefined()
      expect(skip?.reason).toBe("disabled")
      expect(registry.get("disabled-ext")).toBeUndefined()
    } finally {
      try {
        rmSync(stateFile, { force: true })
      } catch {
        // ignore
      }
    }
  })

  it("(h) state grants allow a permission-requesting ext to mount", async () => {
    writeExt({
      root: roots.global,
      name: "fs-ext",
      manifest: {
        name: "fs-ext",
        permissions: { fs: ["/tmp"] },
      },
    })
    const registry = createRegistry()
    const stateFile = join(tmpdir(), `pid-loader-state-${Math.random().toString(36).slice(2)}.json`)
    writeState(stateFile, {
      "fs-ext": { enabled: true, grants: { fs: ["/tmp"] } },
    })
    try {
      const res = await loadExtensions({
        roots,
        registry,
        granted: {},
        importer: async () => pingModule("fs-ext-ok"),
        stateFile,
      })
      expect(res.loaded).toContain("fs-ext")
      expect(res.skipped.find((s) => s.name === "fs-ext")).toBeUndefined()
      expect(registry.get("fs-ext")).toBeDefined()
    } finally {
      try {
        rmSync(stateFile, { force: true })
      } catch {
        // ignore
      }
    }
  })

  it("(i) ext with ungranted permission still skipped with missing list when state has no grants", async () => {
    writeExt({
      root: roots.global,
      name: "exec-ext",
      manifest: {
        name: "exec-ext",
        permissions: { exec: ["rm"] },
      },
    })
    const registry = createRegistry()
    const stateFile = join(tmpdir(), `pid-loader-state-${Math.random().toString(36).slice(2)}.json`)
    writeState(stateFile, { "exec-ext": { enabled: true, grants: {} } })
    try {
      const res = await loadExtensions({
        roots,
        registry,
        granted: {},
        importer: async () => pingModule("never"),
        stateFile,
      })
      expect(res.loaded).not.toContain("exec-ext")
      const skip = res.skipped.find((s) => s.name === "exec-ext")
      expect(skip).toBeDefined()
      expect(skip?.reason).toContain("exec:rm")
    } finally {
      try {
        rmSync(stateFile, { force: true })
      } catch {
        // ignore
      }
    }
  })

  it("(k) local ext state is per-project: a disable in project A does not propagate to project B", async () => {
    // Without an explicit state/stateFile, the loader resolves a LOCAL ext's
    // state from <project>/.pid/extensions-state.json. Guard against a leaked
    // env override from a sibling test.
    const savedEnv = process.env.PID_EXT_STATE_FILE
    delete process.env.PID_EXT_STATE_FILE
    const emptyGlobal = mkdtempSync(join(tmpdir(), "pid-ext-g-empty-"))
    const projA = mkdtempSync(join(tmpdir(), "pid-proj-a-"))
    const projB = mkdtempSync(join(tmpdir(), "pid-proj-b-"))
    cleanups.push(emptyGlobal, projA, projB)

    // Both projects ship the SAME-named local extension.
    const localA = join(projA, ".pid/extensions")
    const localB = join(projB, ".pid/extensions")
    writeExt({ root: localA, name: "shared", manifest: { name: "shared" } })
    writeExt({ root: localB, name: "shared", manifest: { name: "shared" } })

    // Disable it ONLY in project A's own state file.
    writeState(join(dirname(localA), "extensions-state.json"), {
      shared: { enabled: false, grants: {} },
    })

    try {
      const resA = await loadExtensions({
        roots: { global: emptyGlobal, local: localA },
        registry: createRegistry(),
        granted: {},
        importer: async () => pingModule("shared"),
      })
      expect(resA.loaded).not.toContain("shared")
      expect(resA.skipped.find((s) => s.name === "shared")?.reason).toBe("disabled")

      // Project B has no state file → the disable must NOT leak across projects.
      const resB = await loadExtensions({
        roots: { global: emptyGlobal, local: localB },
        registry: createRegistry(),
        granted: {},
        importer: async () => pingModule("shared"),
      })
      expect(resB.loaded).toContain("shared")
    } finally {
      if (savedEnv !== undefined) process.env.PID_EXT_STATE_FILE = savedEnv
    }
  })

  it("(j) absent name in state defaults to enabled=true (no state file => all enabled)", async () => {
    writeExt({ root: roots.global, name: "no-state-ext", manifest: { name: "no-state-ext" } })
    const registry = createRegistry()
    // Pass an empty state object — absent name means enabled by default
    const res = await loadExtensions({
      roots,
      registry,
      granted: {},
      importer: async () => pingModule("no-state-ext-ok"),
      state: {},
    })
    expect(res.loaded).toContain("no-state-ext")
  })

  describe("findProjectRoot", () => {
    it("walks up from a subdir to the nearest ancestor with a .pid dir", () => {
      const root = mkdtempSync(join(tmpdir(), "pid-proj-"))
      cleanups.push(root)
      mkdirSync(join(root, ".pid", "extensions"), { recursive: true })
      const sub = join(root, "apps", "daemon")
      mkdirSync(sub, { recursive: true })
      // realpath() to normalise macOS /var → /private/var symlink differences.
      expect(realpathSync(findProjectRoot(sub))).toBe(realpathSync(root))
    })

    it("walks up to an ancestor with a .git dir when no .pid exists", () => {
      const root = mkdtempSync(join(tmpdir(), "pid-proj-git-"))
      cleanups.push(root)
      mkdirSync(join(root, ".git"), { recursive: true })
      const sub = join(root, "apps", "daemon")
      mkdirSync(sub, { recursive: true })
      expect(realpathSync(findProjectRoot(sub))).toBe(realpathSync(root))
    })

    it("falls back to the start dir when no project marker is found", () => {
      const lonely = mkdtempSync(join(tmpdir(), "pid-lonely-"))
      cleanups.push(lonely)
      expect(realpathSync(findProjectRoot(lonely))).toBe(realpathSync(lonely))
    })
  })
})
