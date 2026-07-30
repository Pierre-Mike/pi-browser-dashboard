import { describe, expect, it } from "bun:test"
import { join } from "node:path"
import { SESSION_STATE_SLUGS } from "@pid/shared"
import {
  IDLE_STATES,
  INK_SWATCHES,
  isReportingState,
  RADIUS_ROLES,
  REPORTING_STATES,
  SURFACE_SWATCHES,
} from "./themeLab"

// The config is loaded through a computed specifier for the same reason
// themeCatalog.test.ts does it: tsc never has to resolve a .js module.
const CONFIG_PATH = join(import.meta.dir, "..", "..", "..", "tailwind.config.js")

describe("the idle / reporting partition", () => {
  it("splits the state vocabulary in two, with nothing lost and nothing counted twice", () => {
    expect([...IDLE_STATES, ...REPORTING_STATES].sort()).toEqual([...SESSION_STATE_SLUGS].sort())
    expect(new Set([...IDLE_STATES, ...REPORTING_STATES]).size).toBe(SESSION_STATE_SLUGS.length)
  })

  it("puts exactly the muted states on the idle side", () => {
    // Derived from `stateColor`, not listed there, so this is the assertion that
    // the derivation still agrees with the tones the sidebar paints.
    expect([...IDLE_STATES].sort()).toEqual(["idle", "stopped", "unknown"])
  })

  it("puts five states on the reporting side — the ones an idle page never shows", () => {
    // The number matters: it is why the lab has two columns at all. `prism`
    // cleared every gate with an idle dashboard showing one hue, because
    // success/warning/error/info live behind these five.
    expect([...REPORTING_STATES].sort()).toEqual([
      "blocked",
      "done",
      "failed",
      "needs_input",
      "working",
    ])
  })

  it("classifies by tone rather than by name", () => {
    expect(isReportingState("working")).toBe(true)
    expect(isReportingState("idle")).toBe(false)
    // `stopped` is the interesting one: it uses `bg-neutral/20` for its chip but
    // plain `text-base-content` for its ink, so it is muted, not reporting.
    expect(isReportingState("stopped")).toBe(false)
  })
})

describe("the lab renders every token the config declares", () => {
  it("covers each --color-* token as a surface, as ink, or deliberately", async () => {
    // This is what stops the lab from silently going stale. A token added to
    // tailwind.config.js that nothing here paints is a token nobody reviews.
    const mod = await import(CONFIG_PATH)
    const first = (mod.THEMES as ReadonlyArray<Record<string, string>>)[0] ?? {}
    const declared = Object.keys(first)
      .filter((key) => key.startsWith("--color-"))
      .map((key) => key.slice("--color-".length))
    const painted = new Set<string>([
      ...SURFACE_SWATCHES.map((s) => s.token),
      ...INK_SWATCHES.map((s) => s.token),
      // Shown as its own paragraph on `bg-primary` — the one content token every
      // theme declares, and the one with a 4.5:1 gate on it.
      "primary-content",
      // The panel's own text colour, so it is on screen in every row.
      "base-content",
    ])
    expect(declared.filter((token) => !painted.has(token))).toEqual([])
  })

  it("names each ink swatch's class after its token, so nothing renders transparent", () => {
    // Tailwind scans source for literal class names: a computed `text-${token}`
    // emits no CSS at all. This keeps the table honest about that.
    for (const { token, ink } of INK_SWATCHES) expect(ink).toBe(`text-${token}`)
    for (const { token, surface } of SURFACE_SWATCHES) expect(surface).toBe(`bg-${token}`)
  })

  it("shows all three radius roles, each named after the var it reads", () => {
    expect(RADIUS_ROLES.map((r) => r.role)).toEqual([
      "--radius-box",
      "--radius-field",
      "--radius-selector",
    ])
    expect(RADIUS_ROLES.map((r) => r.cls)).toEqual(["rounded-box", "rounded-btn", "rounded-badge"])
  })

  it("keeps base-100 in the surface list, being most of the page", () => {
    // ~75% of the painted pixels at 1440x900 (977,772 px² measured for #531);
    // the next surface is 38,080. A lab that reviewed only the accents would be
    // reviewing ~2% of the screen.
    expect(SURFACE_SWATCHES.map((s) => s.token)).toContain("base-100")
    expect(SURFACE_SWATCHES.map((s) => s.token)).toContain("base-300")
  })
})
