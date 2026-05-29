import { describe, expect, it } from "bun:test"
import type { ExtensionManifest } from "./types"

// Unit tests for type shape and data-level logic; the hook itself is tested
// via Playwright e2e against the live daemon.

describe("ExtensionManifest type", () => {
  it("accepts a valid iframe manifest", () => {
    const m: ExtensionManifest = {
      name: "my-ext",
      version: "1.0.0",
      tier: "iframe",
      permissions: ["fs"],
      scope: "global",
      requested: ["fs"],
      granted: [],
      enabled: true,
    }
    expect(m.tier).toBe("iframe")
    expect(m.permissions).toContain("fs")
    expect(m.requested).toContain("fs")
    expect(m.granted).toEqual([])
    expect(m.enabled).toBe(true)
  })

  it("accepts a manifest with contributes.tabs", () => {
    const m: ExtensionManifest = {
      name: "tab-ext",
      version: "0.1.0",
      tier: "iframe",
      contributes: { tabs: [{ key: "my-tab", label: "My Tab" }] },
      permissions: [],
      scope: "local",
      requested: [],
      granted: [],
      enabled: true,
    }
    expect(m.contributes?.tabs).toHaveLength(1)
  })

  it("accepts a manifest with contributes.projectPanels", () => {
    const m: ExtensionManifest = {
      name: "panel-ext",
      version: "0.2.0",
      tier: "esm",
      contributes: { projectPanels: [{ key: "panel" }] },
      permissions: ["events"],
      scope: "global",
      requested: ["events"],
      granted: ["events"],
      enabled: false,
    }
    expect(m.contributes?.projectPanels).toHaveLength(1)
    expect(m.enabled).toBe(false)
  })

  it("permissions is an array of capability key strings", () => {
    const m: ExtensionManifest = {
      name: "perm-ext",
      version: "1.0.0",
      tier: "iframe",
      permissions: ["fs", "net", "exec", "events"],
      scope: "global",
      requested: ["fs", "net", "exec", "events"],
      granted: ["fs"],
      enabled: true,
    }
    expect(m.permissions).toEqual(["fs", "net", "exec", "events"])
    expect(m.granted).toEqual(["fs"])
  })
})
