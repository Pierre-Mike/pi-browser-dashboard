import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  EXT_ICON,
  railExpandBtnClass,
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

  it("frames the dock as a scrollable bar tinted by base-200, shaped by the theme", () => {
    // Was pinned to `rounded-xl`. That literal was the bug: the dock is the
    // most-looked-at chrome in the app, and it stayed soft-cornered in the
    // fully-square `terminal` family because its radius was a component
    // decision rather than a theme one. `rounded-box` reads `--rounded-box`.
    expect(tabDockNavClass).toContain("rounded-box")
    expect(tabDockNavClass).toContain("bg-base-200/60")
    expect(tabDockNavClass).toContain("overflow-x-auto")
  })

  it("shapes the dock's controls from the theme too, not from a fixed radius", () => {
    // The rail and the reopen chip are the same surface returning, so they take
    // the same two tokens: `--rounded-box` for a panel, `--rounded-btn` for a
    // control. semanticRadius.test.ts enforces this across the whole app; these
    // assertions pin the specific tokens this module chose.
    expect(subTabRailClass).toContain("rounded-box")
    expect(tabButtonClass(false)).toContain("rounded-btn")
    expect(subTabButtonClass(false)).toContain("rounded-btn")
    expect(railExpandBtnClass).toContain("rounded-btn")
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
      // The session drill-in docks its own sections here too.
      "brainstorm",
    ]) {
      expect(TAB_ICONS[key]).toBeTruthy()
    }
  })

  it("ships no glyph for a section no dock renders", () => {
    // Canvas is retired (Brainstorm boards replaced it) and Chat is deleted
    // outright (the terminal is the conversation). A glyph with no dock behind
    // it is dead weight fallow cannot see, because TAB_ICONS is keyed by string.
    expect(TAB_ICONS.canvas).toBeUndefined()
    expect(TAB_ICONS.chat).toBeUndefined()
  })

  it("reuses the extensions glyph for extension-contributed tabs", () => {
    expect(EXT_ICON).toBe(TAB_ICONS.extensions)
  })

  it("tightens the dock bar and tab button padding for a denser, single-line topbar", () => {
    // Regression: the project dashboard used to spend two stacked rows on the
    // header + dock; this shaves vertical padding so both fit one line.
    expect(tabDockNavClass).toContain("py-1")
    expect(tabDockNavClass).not.toContain("py-1.5")
    expect(tabButtonClass(false)).toContain("px-2.5 py-1")
    expect(tabButtonClass(false)).not.toContain("py-1.5")
  })

  it("grows each tab to a tappable height below lg, without loosening desktop density", () => {
    // py-1 around a text-xs line is ~24px — fine for a cursor, a coin toss for
    // a thumb. A min-height rather than more padding is what lets the same
    // string stay dense on desktop: the assertion above still holds.
    const cls = tabButtonClass(false)
    expect(cls).toContain("min-h-8")
    expect(cls).toContain("lg:min-h-0")
  })

  it("stacks the sub-tab rail as a scrollable column tinted like the dock, narrower on small screens", () => {
    expect(subTabRailClass).toContain("flex-col")
    // 192px of a 390px phone is half the width gone before the panel starts.
    expect(subTabRailClass).toContain("w-40")
    expect(subTabRailClass).toContain("lg:w-48")
    expect(subTabRailClass).toContain("overflow-y-auto")
    expect(subTabRailClass).toContain("bg-base-200/60")
  })

  it("reopens a collapsed rail from a topbar chip, not a column beside the panel", () => {
    // The old expand control was a full-height w-8 bar sitting where the rail
    // had been, so a "collapsed" rail still cost the panel ~40px of width.
    expect(railExpandBtnClass).not.toContain("w-8")
    expect(railExpandBtnClass).toContain("shrink-0")
    expect(railExpandBtnClass).toContain("h-6 w-6")
    // Still reads as the rail's surface returning.
    expect(railExpandBtnClass).toContain("bg-base-200/60")
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
