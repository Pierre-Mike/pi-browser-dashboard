import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

// The button's only logic is a POST to the session's pty; the message it sends is
// pure and unit-tested in canvas/canvasBriefing.test.ts. Checked structurally
// here, same approach as the other shells in this app.
const src = readFileSync(join(import.meta.dir, "BriefAgentButton.tsx"), "utf8")

describe("brief-agent button", () => {
  it("sends the briefing through the typed RPC client, never a raw fetch", () => {
    expect(src).toContain('from "../../lib/api"')
    expect(src).toContain('client.sessions[":id"].send.$post')
    expect(src).not.toContain("fetch(")
    expect(src).not.toContain("axios")
  })

  it("types the message the pure briefing builds, with a trailing return", () => {
    // Without the \r the text lands in the prompt and just sits there.
    expect(src).toContain("briefingMessage({ path: file, format })")
    expect(src).toContain("\\r")
  })

  it("briefs the ABSOLUTE path, since the agent's cwd is not the browser's", () => {
    expect(src).toContain("readonly file: string")
    expect(src).not.toContain("readonly path: string")
  })

  it("cannot be double-fired while a send is in flight", () => {
    expect(src).toContain("if (busy) return")
    expect(src).toContain("disabled={busy}")
  })

  it("reports a failed send rather than silently doing nothing", () => {
    expect(src).toContain("failed: HTTP ${res.status}")
    expect(src).toContain("text-error")
  })

  it("paints with semantic tokens, not the raw Tailwind palette", () => {
    for (const raw of ["slate-", "sky-", "amber-", "rose-", "dark:"]) {
      expect(src).not.toContain(raw)
    }
  })
})
