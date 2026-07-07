import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  EXT_ICON,
  subTabButtonClass,
  subTabRailClass,
  TAB_ICONS,
  tabButtonClass,
  tabDockNavClass,
} from "./tabDock"

const src = readFileSync(join(import.meta.dir, "tabDock.tsx"), "utf8")

describe("shared tab dock", () => {
  it("keeps the raw Icon component module-private (callers use TAB_ICONS/EXT_ICON)", () => {
    // Exporting Icon with no external consumer trips the fallow dead-code gate.
    expect(src).toMatch(/^const Icon = /m)
    expect(src).not.toMatch(/export const Icon\b/)
  })

  it("frames the dock as a rounded, scrollable bar tinted by base-200", () => {
    expect(tabDockNavClass).toContain("rounded-xl")
    expect(tabDockNavClass).toContain("bg-base-200/60")
    expect(tabDockNavClass).toContain("overflow-x-auto")
  })

  it("fills the active tab with daisyUI primary and mutes idle tabs", () => {
    const active = tabButtonClass(true)
    const idle = tabButtonClass(false)
    expect(active).toContain("bg-primary text-primary-content")
    expect(idle).not.toContain("bg-primary")
    expect(idle).toContain("hover:bg-base-300/70")
  })

  it("ships an icon for every section the two navs render", () => {
    for (const key of [
      "terminal",
      "orchestration",
      "activity",
      "claude",
      "library",
      "extensions",
      "tunnel",
      "github",
      "files",
    ]) {
      expect(TAB_ICONS[key]).toBeTruthy()
    }
  })

  it("reuses the extensions glyph for extension-contributed tabs", () => {
    expect(EXT_ICON).toBe(TAB_ICONS.extensions)
  })

  it("stacks the sub-tab rail as a fixed-width, scrollable column tinted like the dock", () => {
    expect(subTabRailClass).toContain("flex-col")
    expect(subTabRailClass).toContain("w-48")
    expect(subTabRailClass).toContain("overflow-y-auto")
    expect(subTabRailClass).toContain("bg-base-200/60")
  })

  it("fills the active sub-tab with primary and left-aligns full-width rows", () => {
    const active = subTabButtonClass(true)
    const idle = subTabButtonClass(false)
    expect(active).toContain("bg-primary text-primary-content")
    expect(active).toContain("w-full")
    expect(active).toContain("text-left")
    expect(idle).not.toContain("bg-primary")
    expect(idle).toContain("hover:bg-base-300/70")
  })
})
