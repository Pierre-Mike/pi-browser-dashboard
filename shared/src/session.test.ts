import { describe, expect, it } from "bun:test"
import {
  decodeSessionState,
  decodeSessionStateArray,
  isSessionStateSlug,
  SESSION_STATE_SLUGS,
} from "./session"

// A minimal body: only the three fields the daemon always sets. Everything else
// is wire-optional because JSON.stringify drops undefined keys.
const minimal = { short: "abc123", state: "working", source: "state.json" } as const

describe("decodeSessionState", () => {
  it("accepts a body carrying only the always-present fields", () => {
    const decoded = decodeSessionState(minimal)
    expect(decoded.short).toBe("abc123")
    expect(decoded.state).toBe("working")
    expect(decoded.detail).toBeUndefined()
  })

  it("round-trips a fully populated body through JSON", () => {
    const full = {
      ...minimal,
      state: "unknown",
      degradedFrom: "compacting",
      detail: "waiting",
      tempo: "steady",
      intent: "ship the thing",
      name: "feat/thing",
      sessionId: "s-1",
      cwd: "/tmp/x",
      createdAt: "2026-07-29T00:00:00.000Z",
      updatedAt: "2026-07-29T00:01:00.000Z",
      linkScanPath: "/tmp/x/log",
      worktreePath: "/tmp/x/.wt",
      worktreeBranch: "feat/thing",
      result: { exitCode: 0 },
      harness: "pi",
    } as const
    expect(decodeSessionState(JSON.parse(JSON.stringify(full)))).toEqual(full)
  })

  // The two fields apps/web's hand-written mirror was missing. This test is the
  // reason the contract moved here: a mirror cannot fail.
  it("carries the worktree fields the old web mirror had drifted away from", () => {
    const decoded = decodeSessionState({
      ...minimal,
      worktreePath: "/tmp/wt",
      worktreeBranch: "feat/x",
    })
    expect(decoded.worktreePath).toBe("/tmp/wt")
    expect(decoded.worktreeBranch).toBe("feat/x")
  })

  it("rejects an undocumented field instead of silently dropping it", () => {
    expect(() => decodeSessionState({ ...minimal, totallyNew: 1 })).toThrow()
  })

  it("rejects a slug outside the vocabulary", () => {
    expect(() => decodeSessionState({ ...minimal, state: "compacting" })).toThrow()
  })

  it("rejects a missing `source` — consumers rely on being able to explain a state", () => {
    expect(() => decodeSessionState({ short: "a", state: "idle" })).toThrow()
  })
})

describe("decodeSessionStateArray", () => {
  it("decodes a list response", () => {
    expect(decodeSessionStateArray([minimal, { ...minimal, short: "def456" }])).toHaveLength(2)
  })

  it("fails the whole list when one element is malformed", () => {
    expect(() => decodeSessionStateArray([minimal, { short: "x" }])).toThrow()
  })
})

describe("isSessionStateSlug", () => {
  it("accepts every slug in the exported vocabulary", () => {
    for (const slug of SESSION_STATE_SLUGS) expect(isSessionStateSlug(slug)).toBe(true)
  })

  it("keeps both the current and the legacy waiting-on-user slugs", () => {
    expect(isSessionStateSlug("blocked")).toBe(true)
    expect(isSessionStateSlug("needs_input")).toBe(true)
  })

  it("rejects an unrecognized slug", () => {
    expect(isSessionStateSlug("compacting")).toBe(false)
  })
})
