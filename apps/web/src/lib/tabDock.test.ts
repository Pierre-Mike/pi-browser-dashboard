import { describe, expect, it } from "bun:test"
import { EXT_ICON, TAB_ICONS, tabButtonClass, tabDockNavClass } from "./tabDock"

describe("shared tab dock", () => {
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
})
