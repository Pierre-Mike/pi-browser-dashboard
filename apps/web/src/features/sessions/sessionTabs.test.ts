import { describe, expect, it } from "bun:test"
import { TAB_ICONS } from "../../lib/tabDock"
import { SESSION_TAB_DOCK, SESSION_TABS } from "./sessionTabs"

describe("session tab dock", () => {
  it("leads with Terminal, the drill-in's default tab", () => {
    // Same Terminal-leading shape as the project dashboard's dock, so the two
    // surfaces open on the same section.
    expect(SESSION_TAB_DOCK[0]).toEqual({ key: "terminal", label: "Terminal" })
  })

  it("docks exactly the four drill-in sections, title-cased", () => {
    expect(SESSION_TAB_DOCK.map((t) => t.key)).toEqual(["terminal", "chat", "canvas", "files"])
    expect(SESSION_TAB_DOCK.map((t) => t.label)).toEqual(["Terminal", "Chat", "Canvas", "Files"])
  })

  it("derives the ?tab= whitelist from the dock so no section is dockable-but-unroutable", () => {
    expect([...SESSION_TABS].sort()).toEqual([...SESSION_TAB_DOCK.map((t) => t.key)].sort())
  })

  it("has a shared section glyph for every docked tab", () => {
    // A missing glyph would render a label with no icon, breaking the dock's
    // icon+label rhythm on this surface only.
    for (const t of SESSION_TAB_DOCK) expect(TAB_ICONS[t.key]).toBeTruthy()
  })
})
