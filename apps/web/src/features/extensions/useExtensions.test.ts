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
    }
    expect(m.tier).toBe("iframe")
    expect(m.permissions).toContain("fs")
  })

  it("accepts a manifest with contributes.tabs", () => {
    const m: ExtensionManifest = {
      name: "tab-ext",
      version: "0.1.0",
      tier: "iframe",
      contributes: { tabs: [{ key: "my-tab", label: "My Tab" }] },
      permissions: [],
      scope: "local",
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
    }
    expect(m.contributes?.projectPanels).toHaveLength(1)
  })

  it("permissions is an array of capability key strings", () => {
    const m: ExtensionManifest = {
      name: "perm-ext",
      version: "1.0.0",
      tier: "iframe",
      permissions: ["fs", "net", "exec", "events"],
      scope: "global",
    }
    expect(m.permissions).toEqual(["fs", "net", "exec", "events"])
  })
})
