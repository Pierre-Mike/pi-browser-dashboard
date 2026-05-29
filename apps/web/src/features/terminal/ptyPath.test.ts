import { describe, expect, it } from "bun:test"
import { shellQuotePath } from "./ptyPath"

describe("shellQuotePath", () => {
  it("passes through a path with no spaces unchanged", () => {
    expect(shellQuotePath("/abs/note.txt")).toBe("/abs/note.txt")
  })

  it("single-quotes a path that contains a space", () => {
    // A path like "/uploads/2026-05-29/uuid-my doc.txt" must arrive at the
    // pty as a single shell token. Without quoting the shell sees two words.
    expect(shellQuotePath("/uploads/2026-05-29/uuid-my doc.txt")).toBe(
      "'/uploads/2026-05-29/uuid-my doc.txt'",
    )
  })

  it("single-quotes a path with multiple spaces", () => {
    expect(shellQuotePath("/home/user/my great file.ts")).toBe("'/home/user/my great file.ts'")
  })

  it("does not double-quote a plain path (no-op for the shell)", () => {
    // The result must be shell-safe as a single token. A bare no-space path
    // is already a single token; wrapping it would add noise for no gain.
    const result = shellQuotePath("/tmp/file.txt")
    expect(result.startsWith("'")).toBe(false)
    expect(result).toBe("/tmp/file.txt")
  })

  it("handles a path that is only spaces by quoting it", () => {
    expect(shellQuotePath("/ /")).toBe("'/ /'")
  })

  it("TerminalView contract: ws.send receives a shell-safe single token for a spaced path", () => {
    // This is the exact transformation TerminalView applies before ws.send.
    // The assertion guards the pty injection contract: one ws.send call, one
    // shell word, regardless of spaces in the daemon-returned path.
    const daemonPath = "/pid-uploads/2026-05-29/abc-my document.pdf"
    const sent = shellQuotePath(daemonPath)
    // A compliant shell parses `'…'` as exactly one word.
    expect(sent).toBe("'/pid-uploads/2026-05-29/abc-my document.pdf'")
    // The single-quote guard: sanitiseName replaces `'` with `_`, so no
    // server-returned path can close the quote — the wrapping is always safe.
    expect(sent.indexOf("'", 1)).toBe(sent.length - 1)
  })
})
