import { describe, expect, it } from "bun:test"
import {
  type TerminalStateEvent,
  terminalStateAddsInfo,
  terminalStateKey,
  terminalStateTitle,
} from "./terminalState"

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

// A session card already carries the supervisor's own state badge, so a second
// chip from the terminal screen earns its space only when the two disagree —
// which is exactly the case the unattended poller exists to surface (a
// supervisor that thinks a session is idle while its screen shows a spinner or
// a permission prompt).
describe("terminalStateAddsInfo", () => {
  const event = (state: TerminalStateEvent["state"]): TerminalStateEvent => ({
    scope: "session",
    id: "abc123",
    state,
    matcher: "thinking-gerund",
    at: "2026-07-29T00:00:00.000Z",
  })

  it("is false when the daemon has never classified this terminal", () => {
    expect(terminalStateAddsInfo({ sessionState: "idle", terminal: undefined })).toBe(false)
  })

  it("is false for unknown — an unclassified screen is not a disagreement", () => {
    expect(terminalStateAddsInfo({ sessionState: "working", terminal: event("unknown") })).toBe(
      false,
    )
  })

  it("is false when the screen agrees with the supervisor", () => {
    expect(terminalStateAddsInfo({ sessionState: "working", terminal: event("working") })).toBe(
      false,
    )
    expect(terminalStateAddsInfo({ sessionState: "idle", terminal: event("idle") })).toBe(false)
  })

  // "blocked" and "needs_input" are the same fact under two names — the screen
  // showing a permission prompt for a session the supervisor already reports as
  // waiting is agreement, not news.
  it("treats a blocked screen as agreeing with needs_input", () => {
    expect(terminalStateAddsInfo({ sessionState: "needs_input", terminal: event("blocked") })).toBe(
      false,
    )
  })

  it("is true when the screen is working but the supervisor says otherwise", () => {
    expect(terminalStateAddsInfo({ sessionState: "idle", terminal: event("working") })).toBe(true)
    expect(terminalStateAddsInfo({ sessionState: "done", terminal: event("working") })).toBe(true)
  })

  it("is true when the screen is blocked but the supervisor thinks work continues", () => {
    expect(terminalStateAddsInfo({ sessionState: "working", terminal: event("blocked") })).toBe(
      true,
    )
  })
})
