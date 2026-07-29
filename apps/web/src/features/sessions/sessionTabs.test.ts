import { describe, expect, it } from "bun:test"
import { TAB_ICONS } from "../../lib/tabDock"
import {
  isSessionTabActive,
  SESSION_TAB_DOCK,
  SESSION_TABS,
  sessionSectionFor,
} from "./sessionTabs"

describe("session tab dock", () => {
  it("leads with Terminal, the drill-in's default tab", () => {
    // Same Terminal-leading shape as the project dashboard's dock, so the two
    // surfaces open on the same section.
    expect(SESSION_TAB_DOCK[0]).toEqual({ key: "terminal", label: "Terminal" })
  })

  it("docks exactly the four drill-in sections, title-cased", () => {
    // Brainstorm is the only drawing section: a board is a canvas file in this
    // session's own worktree, which is where the retired Canvas tab's scratch
    // drawing wanted to be anyway.
    expect(SESSION_TAB_DOCK.map((t) => t.key)).toEqual(["terminal", "chat", "brainstorm", "files"])
    expect(SESSION_TAB_DOCK.map((t) => t.label)).toEqual([
      "Terminal",
      "Chat",
      "Brainstorm",
      "Files",
    ])
  })

  it("docks no Canvas section", () => {
    expect(SESSION_TAB_DOCK.map((t) => t.key)).not.toContain("canvas")
    expect(SESSION_TABS).not.toContain("canvas" as never)
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

describe("isSessionTabActive", () => {
  it("lights the exact section a plain tab names", () => {
    expect(isSessionTabActive({ tab: "terminal", key: "terminal" })).toBe(true)
    expect(isSessionTabActive({ tab: "terminal", key: "files" })).toBe(false)
  })

  it("keeps Brainstorm lit while one of its boards is selected", () => {
    const tab = "brainstorm:brainstorms%2Fauth.canvas"
    expect(isSessionTabActive({ tab, key: "brainstorm" })).toBe(true)
    expect(isSessionTabActive({ tab, key: "terminal" })).toBe(false)
  })
})

describe("sessionSectionFor", () => {
  it("resolves a board tab to the Brainstorm section", () => {
    expect(sessionSectionFor("brainstorm:docs%2Fa.canvas")).toBe("brainstorm")
    expect(sessionSectionFor("brainstorm")).toBe("brainstorm")
  })

  it("passes a plain section through", () => {
    expect(sessionSectionFor("files")).toBe("files")
  })
})
