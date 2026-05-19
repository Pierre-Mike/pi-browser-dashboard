import { describe, expect, test } from "bun:test"
import { ageMs, parseRoster, parseState } from "./sessions.core"

describe("parseState — additional coverage", () => {
  test("downcases and trims a known state string before matching", () => {
    expect(parseState({ short: "x", json: { state: "  Needs_Input  " } }).state).toBe("needs_input")
  })

  test("falls back to 'idle' when state is not a string", () => {
    expect(parseState({ short: "x", json: { state: 42 } }).state).toBe("idle")
    expect(parseState({ short: "x", json: { state: null } }).state).toBe("idle")
  })

  test("prefers daemonShort over the registry short when both are present", () => {
    expect(parseState({ short: "ignore-me", json: { daemonShort: "real" } }).short).toBe("real")
  })

  test("uses the registry short when daemonShort is absent or null", () => {
    expect(parseState({ short: "abcd", json: { daemonShort: null } }).short).toBe("abcd")
    expect(parseState({ short: "abcd", json: {} }).short).toBe("abcd")
  })

  test("surfaces output.result as the session result", () => {
    const s = parseState({
      short: "abcd",
      json: { output: { result: { ok: true, value: 7 } } },
    })
    expect(s.result).toEqual({ ok: true, value: 7 })
  })

  test("tolerates a null output without crashing", () => {
    expect(parseState({ short: "abcd", json: { output: null } }).result).toBeUndefined()
  })

  test("normalises nulls to undefined for optional string fields", () => {
    const s = parseState({
      short: "abcd",
      json: {
        detail: null,
        tempo: null,
        intent: null,
        name: null,
        sessionId: null,
        cwd: null,
        createdAt: null,
        updatedAt: null,
        linkScanPath: null,
      },
    })
    expect(s.detail).toBeUndefined()
    expect(s.tempo).toBeUndefined()
    expect(s.intent).toBeUndefined()
    expect(s.name).toBeUndefined()
    expect(s.sessionId).toBeUndefined()
    expect(s.cwd).toBeUndefined()
    expect(s.createdAt).toBeUndefined()
    expect(s.updatedAt).toBeUndefined()
    expect(s.linkScanPath).toBeUndefined()
  })

  test("ignores unknown fields rather than throwing", () => {
    expect(parseState({ short: "abcd", json: { state: "working", futureField: "noise" } }).state)
      .toBe("working")
  })
})

describe("parseRoster — additional coverage", () => {
  test("captures supervisor metadata", () => {
    const r = parseRoster({ supervisorPid: 42, updatedAt: 1700000000 })
    expect(r.supervisorPid).toBe(42)
    expect(r.updatedAt).toBe(1700000000)
  })

  test("ignores unknown top-level fields rather than throwing", () => {
    const r = parseRoster({ workers: { x1: {} }, unexpectedKey: "noise" })
    expect(r.workers).toHaveLength(1)
  })

  test("throws on a fundamentally wrong shape", () => {
    expect(() => parseRoster("not an object")).toThrow()
  })
})

describe("parseState", () => {
  test("surfaces worktreePath and worktreeBranch when present", () => {
    const out = parseState({
      short: "abc12345",
      json: {
        state: "working",
        cwd: "/repo",
        worktreePath: "/repo/.claude/worktrees/feature-x",
        worktreeBranch: "worktree-feature-x",
      },
    })
    expect(out.worktreePath).toBe("/repo/.claude/worktrees/feature-x")
    expect(out.worktreeBranch).toBe("worktree-feature-x")
  })

  test("leaves worktree fields undefined for non-isolated sessions", () => {
    const out = parseState({
      short: "abc12345",
      json: { state: "idle", cwd: "/repo" },
    })
    expect(out.worktreePath).toBeUndefined()
    expect(out.worktreeBranch).toBeUndefined()
  })

  test("normalizes unknown states to idle", () => {
    const out = parseState({ short: "x", json: { state: "weird-state" } })
    expect(out.state).toBe("idle")
  })
})

describe("parseRoster", () => {
  test("returns an empty worker list when roster has no workers field", () => {
    const out = parseRoster({ proto: 1 })
    expect(out.workers).toEqual([])
  })

  test("flattens a workers record into the array shape", () => {
    const out = parseRoster({
      workers: {
        abc12345: {
          pid: 1234,
          cwd: "/repo",
          dispatch: { agent: "general", seed: { intent: "do thing" } },
        },
      },
    })
    expect(out.workers).toHaveLength(1)
    expect(out.workers[0]).toMatchObject({
      short: "abc12345",
      cwd: "/repo",
      agent: "general",
      intent: "do thing",
    })
  })
})

describe("ageMs", () => {
  test("returns undefined for missing createdAt", () => {
    expect(ageMs({ now: 1_000, createdAt: undefined })).toBeUndefined()
  })

  test("returns undefined for unparseable createdAt", () => {
    expect(ageMs({ now: 1_000, createdAt: "not-a-date" })).toBeUndefined()
  })

  test("computes ms since createdAt", () => {
    const created = new Date("2026-01-01T00:00:00Z").getTime()
    expect(ageMs({ now: created + 5_000, createdAt: "2026-01-01T00:00:00Z" })).toBe(5_000)
  })

  test("clamps negative ages to zero", () => {
    const created = new Date("2026-01-01T00:00:00Z").getTime()
    expect(ageMs({ now: created - 1_000, createdAt: "2026-01-01T00:00:00Z" })).toBe(0)
  })
})
