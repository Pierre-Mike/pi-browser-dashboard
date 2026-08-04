import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

// SessionSplit mounts TerminalView, which builds a real xterm against the DOM
// and opens a websocket — out of reach synchronously here. Checked structurally
// instead, same approach as SessionTopbar.test.ts. The *decisions* it makes
// (which pane a `?tab=` opens, what a dock click toggles to) are pure and live
// in sessionTabs.ts, where they are unit-tested directly.
const src = readFileSync(join(import.meta.dir, "SessionSplit.tsx"), "utf8")

describe("session split shell", () => {
  it("renders the terminal unconditionally — it is the surface, not a tab", () => {
    // The whole point of the split: no `?tab=` value and no dock click may
    // unmount the terminal, because unmounting xterm drops the attach and the
    // user loses their scrollback for a round-trip.
    expect(src).toContain('data-testid="session-terminal-pane"')
    expect(src).toContain("<TerminalTab")
    // The terminal is a plain sibling, never inside the pane's conditional.
    const terminalAt = src.indexOf("<TerminalTab")
    const paneAt = src.indexOf("pane === null")
    expect(terminalAt).toBeGreaterThan(-1)
    expect(paneAt).toBeGreaterThan(-1)
    expect(terminalAt).toBeLessThan(paneAt)
  })

  it("docks the optional section to the RIGHT of the terminal", () => {
    // One row, terminal first. Reversing these two is the regression that would
    // put a file tree where the user's shell is meant to be.
    expect(src).toMatch(/session-terminal-pane[\s\S]*session-side-pane/)
    expect(src).toContain("flex flex-1 min-h-0 min-w-0")
  })

  it("gives the terminal the flexible column and the pane the measured one", () => {
    // `flex-1 min-w-0` on the terminal is what lets the pane's px width win
    // without shoving the row off-screen behind a page-wide scrollbar.
    expect(src).toMatch(/session-terminal-pane"\s+className="flex-1 min-h-0 min-w-0"/)
    expect(src).toContain("style={{ width }}")
  })

  it("resizes the pane through the shared panel helpers, not a bespoke drag", () => {
    expect(src).toContain('from "../../lib/panelResize"')
    expect(src).toContain("usePersistedWidth")
    expect(src).toContain("usePanelDrag")
    expect(src).toContain("<PanelResizeHandle")
  })

  it("persists the pane width per-browser under a session-scoped key", () => {
    // Session-scoped, not brainstorm-scoped: the same splitter now sizes Files
    // and Brainstorm alike, so one stored width serves both.
    expect(src).toContain('usePersistedWidth("pid:session:pane-width")')
  })

  it("hides the pane entirely when no section is selected", () => {
    // Not `width: 0` — an empty bordered box beside a full-height terminal
    // reads as a rendering bug, and it would still eat the row's gap.
    expect(src).toContain("pane === null ? null :")
  })

  it("reads the width hooks unconditionally, above the pane's own branch", () => {
    // The pane is conditional but the hooks that size it cannot be, or React
    // sees a different hook count the first time a section opens.
    const widthAt = src.indexOf("usePersistedWidth(")
    expect(widthAt).toBeGreaterThan(-1)
    expect(widthAt).toBeLessThan(src.indexOf("pane === null"))
  })

  it("asks sessionTabs which pane a raw ?tab= opens rather than re-deriving it", () => {
    expect(src).toContain('from "./sessionTabs"')
    expect(src).toContain("sessionPaneFor(tab)")
  })

  it("hosts no chat", () => {
    for (const gone of ["Chat", "chat", "transcript", "Transcript"]) {
      expect(src).not.toContain(gone)
    }
  })

  it("paints with semantic tokens, not the raw Tailwind palette", () => {
    for (const raw of ["slate-", "amber-", "rose-", "dark:"]) expect(src).not.toContain(raw)
  })
})
