import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

// The board panel mounts a live canvas / Excalidraw editor bound to a websocket
// doc room, so it is checked structurally like the other shells in this app.
const src = readFileSync(join(import.meta.dir, "SessionBoardPanel.tsx"), "utf8")

describe("session board panel", () => {
  it("docks no terminal of its own", () => {
    // It used to carry a second TerminalView beside the board. The drill-in's
    // terminal is now permanent and sits to the LEFT of this whole pane, so a
    // board-local terminal was the same pty attached twice, competing for the
    // same width.
    for (const gone of ["TerminalView", "brainstorm-companion", "This session"]) {
      expect(src).not.toContain(gone)
    }
  })

  it("spends its full width on the editor", () => {
    expect(src).toContain('data-testid="session-board-editor"')
    expect(src).toContain("min-w-0")
  })

  it("keeps the board's path visible for both editors", () => {
    // e2e asserts this reads the worktree-relative path; it moved out of the
    // deleted aside rather than disappearing with it.
    expect(src).toContain('data-testid="brainstorm-board-file"')
  })

  it("offers one button that briefs the session's agent about this board", () => {
    // Replaces the docked terminal: instead of typing to a second pty, you send
    // ONE message to the session already running beside the board.
    expect(src).toContain("<BriefAgentButton")
    expect(src).toContain("briefFormatFor(board.kind)")
  })

  it("paints with semantic tokens, not the raw Tailwind palette", () => {
    for (const raw of ["slate-", "amber-", "rose-", "dark:"]) expect(src).not.toContain(raw)
  })
})
