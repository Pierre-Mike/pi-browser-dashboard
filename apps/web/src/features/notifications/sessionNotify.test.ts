import { describe, expect, it } from "bun:test"
import type { SessionState, SessionStateValue } from "../../lib/types"
import { decideNotification, isTerminalState, resolvePrevState } from "./sessionNotify"

const make = (over: Partial<SessionState> = {}): SessionState => ({
  short: "abc123",
  state: "done",
  detail: "",
  tempo: "",
  intent: "",
  name: "",
  sessionId: "sess-1",
  cwd: "/repo",
  createdAt: "",
  updatedAt: "",
  linkScanPath: "",
  ...over,
})

describe("isTerminalState", () => {
  it("treats done/failed/stopped as terminal", () => {
    expect(isTerminalState("done")).toBe(true)
    expect(isTerminalState("failed")).toBe(true)
    expect(isTerminalState("stopped")).toBe(true)
  })

  it("treats working/idle/needs_input as non-terminal", () => {
    expect(isTerminalState("working")).toBe(false)
    expect(isTerminalState("idle")).toBe(false)
    expect(isTerminalState("needs_input")).toBe(false)
  })
})

describe("decideNotification", () => {
  it("fires when crossing from a live state into done", () => {
    const p = decideNotification("working", make({ state: "done", name: "Build feature" }))
    expect(p).not.toBeNull()
    expect(p?.title).toContain("done")
    expect(p?.body).toContain("Build feature")
    expect(p?.tag).toBe("pid-session-abc123-done")
  })

  it("fires when crossing into failed", () => {
    const p = decideNotification("working", make({ state: "failed" }))
    expect(p?.title).toContain("failed")
  })

  it("fires when crossing into stopped from needs_input", () => {
    const p = decideNotification("needs_input", make({ state: "stopped" }))
    expect(p?.title).toContain("stopped")
  })

  it("does not fire on the first sighting of a session (prev undefined)", () => {
    // Avoids a burst on page load / SSE reconnect when stale terminal states
    // arrive without an observed transition.
    expect(decideNotification(undefined, make({ state: "done" }))).toBeNull()
  })

  it("does not re-fire while already terminal (done -> done)", () => {
    expect(decideNotification("done", make({ state: "done" }))).toBeNull()
  })

  it("does not fire when prev was already a different terminal state", () => {
    expect(decideNotification("failed", make({ state: "done" }))).toBeNull()
  })

  it("does not fire on a transition into a non-terminal state", () => {
    expect(decideNotification("working", make({ state: "idle" }))).toBeNull()
    expect(decideNotification("idle", make({ state: "working" }))).toBeNull()
  })

  it("prefers result, then detail, for the body suffix", () => {
    const withResult = decideNotification(
      "working",
      make({ state: "done", name: "Job", result: "merged PR #5", detail: "ignored" }),
    )
    expect(withResult?.body).toContain("merged PR #5")
    expect(withResult?.body).not.toContain("ignored")

    const withDetail = decideNotification(
      "working",
      make({ state: "failed", name: "Job", detail: "exit 1" }),
    )
    expect(withDetail?.body).toContain("exit 1")
  })

  it("falls back name -> intent -> short for the label", () => {
    expect(
      decideNotification("working", make({ state: "done", name: "N", intent: "I" }))?.body,
    ).toContain("N")
    expect(
      decideNotification("working", make({ state: "done", name: "", intent: "I" }))?.body,
    ).toContain("I")
    const onlyShort = decideNotification("working", make({ state: "done", name: "", intent: "" }))
    expect(onlyShort?.body).toContain("abc123")
  })

  it("truncates an overlong body", () => {
    const long = "x".repeat(500)
    const p = decideNotification("working", make({ state: "done", name: "Job", detail: long }))
    expect(p?.body.length).toBeLessThanOrEqual(160)
    expect(p?.body.endsWith("…")).toBe(true)
  })

  it("covers every terminal state value", () => {
    const terminals: SessionStateValue[] = ["done", "failed", "stopped"]
    for (const state of terminals) {
      expect(decideNotification("working", make({ state }))).not.toBeNull()
    }
  })
})

describe("resolvePrevState", () => {
  it("prefers a live SSE-observed state over the roster fallback", () => {
    expect(resolvePrevState("working", "idle")).toBe("working")
  })

  it("falls back to the roster state when nothing was observed live", () => {
    // The initial session list arrives over HTTP, not SSE, so the first
    // session.state event for a session has no live-observed prior. The roster
    // value is the state the user was actually looking at.
    expect(resolvePrevState(undefined, "working")).toBe("working")
  })

  it("is undefined only when neither source knows the session", () => {
    expect(resolvePrevState(undefined, undefined)).toBeUndefined()
  })
})

describe("notification edge seeding (resolvePrevState + decideNotification)", () => {
  it("fires for the working→done edge witnessed via the HTTP roster", () => {
    // Regression: previously this dropped the notification because lastStates
    // (SSE-only) had no entry, so prev was undefined and the guard suppressed.
    const prev = resolvePrevState(undefined, "working")
    expect(decideNotification(prev, make({ state: "done", name: "Build" }))).not.toBeNull()
  })

  it("still suppresses a session already terminal in the roster on load", () => {
    const prev = resolvePrevState(undefined, "done")
    expect(decideNotification(prev, make({ state: "done" }))).toBeNull()
  })

  it("still suppresses a truly first-sighted session (no roster, no live)", () => {
    const prev = resolvePrevState(undefined, undefined)
    expect(decideNotification(prev, make({ state: "done" }))).toBeNull()
  })
})
