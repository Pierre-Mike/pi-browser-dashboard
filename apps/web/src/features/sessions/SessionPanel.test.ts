import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

// SessionPanel mounts a FileTree / brainstorm editor bound to live queries, so
// it is checked structurally like the rest of this feature's shells.
const src = readFileSync(join(import.meta.dir, "SessionPanel.tsx"), "utf8")

describe("session side-pane content", () => {
  it("renders exactly the two docked sections", () => {
    expect(src).toContain("<FileTree")
    expect(src).toContain("<SessionBrainstormTab")
  })

  it("switches on the resolved pane, not on a raw ?tab= string", () => {
    // The raw value can be `brainstorm:<encoded path>`; comparing it to
    // "brainstorm" is the bug that used to need sessionSectionFor everywhere.
    expect(src).toContain('pane === "files"')
    expect(src).not.toContain('tab === "brainstorm"')
  })

  it("holds no chat pane, composer, or transcript query", () => {
    // Chat is deleted, not hidden: a transcript beside a live pty rendered the
    // same turns twice, and the composer duplicated the terminal's own input.
    for (const gone of [
      "ChatComposer",
      "ChatPanel",
      "TranscriptView",
      "chat-transcript",
      "useTranscript",
      "parseTranscriptResponse",
    ]) {
      expect(src).not.toContain(gone)
    }
  })

  it("no longer owns the terminal — the split shell above it does", () => {
    // The terminal outlives every pane switch, so it cannot be mounted from
    // inside the thing that switches.
    expect(src).not.toContain("TerminalTab")
    expect(src).not.toContain("TerminalView")
  })

  it("paints with semantic tokens, not the raw Tailwind palette", () => {
    for (const raw of ["slate-", "amber-", "rose-", "dark:"]) expect(src).not.toContain(raw)
  })
})
