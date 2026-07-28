import { describe, expect, it } from "bun:test"
import { terminalStateKey, terminalStateTitle } from "./terminalState"

describe("terminalStateKey", () => {
  it("joins scope and id with a colon, matching the daemon core", () => {
    expect(terminalStateKey({ scope: "project", id: "pi-browser-dashboard" })).toBe(
      "project:pi-browser-dashboard",
    )
  })
})

describe("terminalStateTitle", () => {
  it("shows matcher and evidence together", () => {
    const title = terminalStateTitle({
      scope: "session",
      id: "abc123",
      state: "working",
      matcher: "thinking-gerund",
      evidence: "Burrowing…(3s · ↓4 tokens)",
      at: "2026-07-28T00:00:00.000Z",
    })
    expect(title).toBe("thinking-gerund: Burrowing…(3s · ↓4 tokens)")
  })

  it("falls back to the matcher name alone when there is no evidence", () => {
    const title = terminalStateTitle({
      scope: "global",
      id: "global",
      state: "idle",
      matcher: "turn-complete",
      at: "2026-07-28T00:00:00.000Z",
    })
    expect(title).toBe("turn-complete")
  })

  it("explains an honest unknown instead of implying a matcher fired", () => {
    const title = terminalStateTitle({
      scope: "orchestrator",
      id: "orchestrator",
      state: "unknown",
      at: "2026-07-28T00:00:00.000Z",
    })
    expect(title).toBe("unknown — no matcher has fired yet")
  })
})
