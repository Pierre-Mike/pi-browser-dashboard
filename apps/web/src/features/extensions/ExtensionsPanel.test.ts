import { describe, expect, it } from "bun:test"
import type { ExtensionManifest } from "./types"

// Pure logic extracted from ExtensionsPanel for unit testing.
// The React component itself is exercised via Playwright e2e.

const CAPABILITIES = ["fs", "exec", "net", "events"] as const
type Capability = (typeof CAPABILITIES)[number]

/**
 * Compute the grants body to POST when toggling a single capability.
 * Mirrors the logic in ExtRow.toggleGrant.
 */
const buildToggleGrantsBody = (
  granted: string[],
  cap: Capability,
): Record<string, string[] | boolean> => {
  const hasFs = granted.includes("fs")
  const hasExec = granted.includes("exec")
  const hasNet = granted.includes("net")
  const hasEvents = granted.includes("events")

  const newGrants: Record<string, string[] | boolean> = {
    fs: hasFs ? ["*"] : [],
    exec: hasExec ? ["*"] : [],
    net: hasNet ? ["*"] : [],
    events: hasEvents,
  }

  if (cap === "events") {
    newGrants.events = !hasEvents
  } else {
    const had = granted.includes(cap)
    newGrants[cap] = had ? [] : ["*"]
  }

  return newGrants
}

const makeManifest = (overrides: Partial<ExtensionManifest> = {}): ExtensionManifest => ({
  name: "test-ext",
  version: "1.0.0",
  tier: "iframe",
  permissions: [],
  scope: "global",
  requested: [],
  granted: [],
  enabled: true,
  ...overrides,
})

describe("ExtensionsPanel — grant toggle logic", () => {
  it("adds fs when not currently granted", () => {
    const body = buildToggleGrantsBody([], "fs")
    expect(body.fs).toEqual(["*"])
  })

  it("removes fs when currently granted", () => {
    const body = buildToggleGrantsBody(["fs"], "fs")
    expect(body.fs).toEqual([])
  })

  it("enables events when not currently granted", () => {
    const body = buildToggleGrantsBody([], "events")
    expect(body.events).toBe(true)
  })

  it("disables events when currently granted", () => {
    const body = buildToggleGrantsBody(["events"], "events")
    expect(body.events).toBe(false)
  })

  it("preserves other grants when toggling one capability", () => {
    const body = buildToggleGrantsBody(["fs", "events"], "exec")
    expect(body.fs).toEqual(["*"])
    expect(body.events).toBe(true)
    expect(body.exec).toEqual(["*"])
  })

  it("removes a previously-granted capability while preserving others", () => {
    const body = buildToggleGrantsBody(["fs", "net"], "fs")
    expect(body.fs).toEqual([])
    expect(body.net).toEqual(["*"])
  })
})

describe("ExtensionsPanel — enabled/disabled state", () => {
  it("manifest with enabled:true shows as enabled", () => {
    const m = makeManifest({ enabled: true })
    expect(m.enabled).toBe(true)
  })

  it("manifest with enabled:false shows as disabled", () => {
    const m = makeManifest({ enabled: false })
    expect(m.enabled).toBe(false)
  })

  it("disabled extension still has granted field", () => {
    const m = makeManifest({ enabled: false, granted: ["fs"] })
    expect(m.granted).toContain("fs")
  })
})

describe("tab visibility filter", () => {
  const exts: ExtensionManifest[] = [
    makeManifest({
      name: "enabled-ext",
      enabled: true,
      tier: "iframe",
      contributes: { tabs: [{ id: "t" }] },
    }),
    makeManifest({
      name: "disabled-ext",
      enabled: false,
      tier: "iframe",
      contributes: { tabs: [{ id: "t" }] },
    }),
    makeManifest({
      name: "no-tab-ext",
      enabled: true,
      tier: "iframe",
      contributes: { tabs: [] },
    }),
  ]

  it("only enabled extensions with tabs appear in tab list", () => {
    const tabExts = exts.filter(
      (e) => e.enabled !== false && e.tier === "iframe" && (e.contributes?.tabs?.length ?? 0) > 0,
    )
    expect(tabExts).toHaveLength(1)
    expect(tabExts[0]?.name).toBe("enabled-ext")
  })

  it("disabled extensions are excluded from tab list", () => {
    const tabExts = exts.filter(
      (e) => e.enabled !== false && e.tier === "iframe" && (e.contributes?.tabs?.length ?? 0) > 0,
    )
    expect(tabExts.find((e) => e.name === "disabled-ext")).toBeUndefined()
  })
})
