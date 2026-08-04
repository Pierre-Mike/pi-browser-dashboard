import { describe, expect, it } from "bun:test"
import { TAB_ICONS } from "../../lib/tabDock"
import {
  isSessionTabActive,
  SESSION_TAB_DOCK,
  SESSION_TABS,
  sessionPaneFor,
  TERMINAL_ONLY_TAB,
  toggleSessionTab,
} from "./sessionTabs"

describe("session tab dock", () => {
  it("docks only the side-pane sections — the terminal is always on, so it is not a tab", () => {
    // The drill-in is a split: terminal permanently left, ONE optional section
    // docked right. A "Terminal" tab would imply the terminal can be switched
    // away from, which is exactly what this layout removed.
    expect(SESSION_TAB_DOCK.map((t) => t.key)).toEqual(["brainstorm", "files"])
    expect(SESSION_TAB_DOCK.map((t) => t.label)).toEqual(["Brainstorm", "Files"])
  })

  it("docks no Chat section", () => {
    // Chat is gone: the terminal IS the conversation now, and a transcript pane
    // beside a live pty showed the same turns twice.
    expect(SESSION_TAB_DOCK.map((t) => t.key)).not.toContain("chat")
    expect(SESSION_TABS).not.toContain("chat" as never)
  })

  it("docks no Canvas section", () => {
    expect(SESSION_TAB_DOCK.map((t) => t.key)).not.toContain("canvas")
    expect(SESSION_TABS).not.toContain("canvas" as never)
  })

  it("keeps ?tab=terminal routable so old deep links land on a closed pane", () => {
    // Not dockable, but still a legal `?tab=` value: every link minted before
    // the split existed says `?tab=terminal`, and it now means "terminal only".
    expect(TERMINAL_ONLY_TAB).toBe("terminal")
    expect(SESSION_TABS).toContain("terminal")
    expect([...SESSION_TABS]).toEqual(["terminal", "brainstorm", "files"])
  })

  it("has a shared section glyph for every docked tab", () => {
    for (const t of SESSION_TAB_DOCK) expect(TAB_ICONS[t.key]).toBeTruthy()
  })
})

describe("sessionPaneFor", () => {
  it("opens no side pane for the terminal-only tab", () => {
    expect(sessionPaneFor("terminal")).toBeNull()
  })

  it("resolves a docked section to its own pane", () => {
    expect(sessionPaneFor("files")).toBe("files")
    expect(sessionPaneFor("brainstorm")).toBe("brainstorm")
  })

  it("resolves a board tab to the Brainstorm pane", () => {
    expect(sessionPaneFor("brainstorm:docs%2Fa.canvas")).toBe("brainstorm")
  })

  it("is total — an unknown tab opens no pane rather than a blank one", () => {
    // validateSearch already whitelists, so this is the belt to that braces:
    // a stale link must never render an empty right pane over the terminal.
    expect(sessionPaneFor("chat")).toBeNull()
    expect(sessionPaneFor("")).toBeNull()
  })
})

describe("toggleSessionTab", () => {
  it("opens the pane on the section a dock click names", () => {
    expect(toggleSessionTab({ tab: "terminal", key: "files" })).toBe("files")
    expect(toggleSessionTab({ tab: "files", key: "brainstorm" })).toBe("brainstorm")
  })

  it("closes the pane when the lit section is clicked again", () => {
    // The dock is how you get the terminal full-width back; without this the
    // pane would be a one-way door.
    expect(toggleSessionTab({ tab: "files", key: "files" })).toBe("terminal")
    expect(toggleSessionTab({ tab: "brainstorm", key: "brainstorm" })).toBe("terminal")
  })

  it("closes the pane from a selected board too, not just the bare section", () => {
    expect(toggleSessionTab({ tab: "brainstorm:docs%2Fa.canvas", key: "brainstorm" })).toBe(
      "terminal",
    )
  })
})

describe("isSessionTabActive", () => {
  it("lights the exact section a plain tab names", () => {
    expect(isSessionTabActive({ tab: "files", key: "files" })).toBe(true)
    expect(isSessionTabActive({ tab: "terminal", key: "files" })).toBe(false)
  })

  it("keeps Brainstorm lit while one of its boards is selected", () => {
    const tab = "brainstorm:brainstorms%2Fauth.canvas"
    expect(isSessionTabActive({ tab, key: "brainstorm" })).toBe(true)
    expect(isSessionTabActive({ tab, key: "files" })).toBe(false)
  })

  it("lights nothing on the terminal-only tab", () => {
    for (const t of SESSION_TAB_DOCK) {
      expect(isSessionTabActive({ tab: TERMINAL_ONLY_TAB, key: t.key })).toBe(false)
    }
  })
})
