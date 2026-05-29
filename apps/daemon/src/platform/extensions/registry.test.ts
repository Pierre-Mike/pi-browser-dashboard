import { describe, expect, it } from "bun:test"
import { Hono } from "hono"
import type { ExtensionManifest } from "./manifest"
import { createRegistry, extensionRegistry } from "./registry"

const mk = (name: string, version = "1.0.0"): ExtensionManifest => ({
  name,
  version,
  tier: "esm",
  daemonEntry: "daemon.ts",
})

describe("createRegistry", () => {
  it("registers, lists, gets", () => {
    const reg = createRegistry()
    reg.register({ manifest: mk("a"), dir: "/g/a", scope: "global" })
    reg.register({ manifest: mk("b"), dir: "/g/b", scope: "global" })
    expect(reg.list().length).toBe(2)
    expect(reg.get("a")?.dir).toBe("/g/a")
    expect(reg.get("missing")).toBeUndefined()
  })

  it("local same-name overrides global, listing the name once", () => {
    const reg = createRegistry()
    reg.register({ manifest: mk("dup", "1.0.0"), dir: "/g/dup", scope: "global" })
    reg.register({ manifest: mk("dup", "2.0.0"), dir: "/l/dup", scope: "local" })
    expect(reg.list().length).toBe(1)
    const got = reg.get("dup")
    expect(got?.scope).toBe("local")
    expect(got?.dir).toBe("/l/dup")
    expect(got?.manifest.version).toBe("2.0.0")
  })

  it("mounts() yields basePath /ext/<name> only for entries with an app", () => {
    const reg = createRegistry()
    const app = new Hono()
    reg.register({ manifest: mk("withapp"), dir: "/g/withapp", app, scope: "global" })
    reg.register({ manifest: mk("noapp"), dir: "/g/noapp", scope: "global" })
    const mounts = reg.mounts()
    expect(mounts.length).toBe(1)
    expect(mounts[0]?.basePath).toBe("/ext/withapp")
    expect(mounts[0]?.app).toBe(app)
  })

  it("clear() empties the registry", () => {
    const reg = createRegistry()
    reg.register({ manifest: mk("a"), dir: "/g/a", scope: "global" })
    reg.clear()
    expect(reg.list().length).toBe(0)
  })

  it("exposes a singleton extensionRegistry", () => {
    extensionRegistry.clear()
    extensionRegistry.register({ manifest: mk("s"), dir: "/g/s", scope: "global" })
    expect(extensionRegistry.get("s")?.dir).toBe("/g/s")
    extensionRegistry.clear()
  })
})
