import { describe, expect, test } from "bun:test"
import {
  ageMs,
  backfillRosterFields,
  mergeStateWithPrior,
  parseRoster,
  parseState,
  type RosterWorker,
  seedFromWorker,
} from "./sessions.core"

describe("parseState — additional coverage", () => {
  test("downcases and trims a known state string before matching", () => {
    expect(parseState({ short: "x", json: { state: "  Needs_Input  " } }).state).toBe("needs_input")
  })

  test("preserves the 'blocked' state the supervisor emits for waiting sessions", () => {
    expect(parseState({ short: "x", json: { state: "blocked" } }).state).toBe("blocked")
    expect(parseState({ short: "x", json: { state: "  Blocked  " } }).state).toBe("blocked")
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
    expect(
      parseState({ short: "abcd", json: { state: "working", futureField: "noise" } }).state,
    ).toBe("working")
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

  // The roster is decoded by `Schema` from `effect`, not asserted. These pin the
  // decode semantics the slice leans on — excess keys tolerated (above), but a
  // wrong-typed *value* rejected — so swapping or upgrading the schema library
  // cannot quietly turn a rejected roster into a silently-accepted one.
  test("rejects a workers value that is not a worker object", () => {
    expect(() => parseRoster({ workers: { x1: "not an object" } })).toThrow()
  })

  test("rejects a wrong-typed field inside a worker rather than coercing it", () => {
    expect(() => parseRoster({ workers: { x1: { pid: "not a number" } } })).toThrow()
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

const worker = (overrides: Partial<RosterWorker> = {}): RosterWorker => ({
  short: "ab12",
  sessionId: "sess-1",
  cwd: "/repo",
  intent: "do thing",
  startedAt: undefined,
  agent: undefined,
  ...overrides,
})

describe("seedFromWorker", () => {
  test("seeds an idle session carrying the roster fields", () => {
    const s = seedFromWorker(worker())
    expect(s).toMatchObject({
      short: "ab12",
      state: "idle",
      intent: "do thing",
      sessionId: "sess-1",
      cwd: "/repo",
    })
  })
})

describe("backfillRosterFields", () => {
  test("fills roster fields the session is missing", () => {
    const existing = parseState({ short: "ab12", json: { state: "done" } })
    const merged = backfillRosterFields({ existing, worker: worker() })
    expect(merged).toMatchObject({ state: "done", intent: "do thing", sessionId: "sess-1" })
  })

  test("returns null when the session already has every field", () => {
    const existing = parseState({
      short: "ab12",
      json: { state: "done", intent: "mine", sessionId: "sess-9", cwd: "/elsewhere" },
    })
    expect(backfillRosterFields({ existing, worker: worker() })).toBeNull()
  })

  test("never overwrites fields the session already has", () => {
    const existing = parseState({
      short: "ab12",
      json: { state: "done", intent: "mine", sessionId: "sess-9" },
    })
    const merged = backfillRosterFields({ existing, worker: worker() })
    expect(merged).toMatchObject({ intent: "mine", sessionId: "sess-9", cwd: "/repo" })
  })
})

describe("mergeStateWithPrior", () => {
  test("state.json wins but roster-derived fields survive omission", () => {
    const prior = seedFromWorker(worker())
    const parsed = parseState({ short: "ab12", json: { state: "working", detail: "busy" } })
    const merged = mergeStateWithPrior({ parsed, prior })
    expect(merged).toMatchObject({
      state: "working",
      detail: "busy",
      intent: "do thing",
      sessionId: "sess-1",
      cwd: "/repo",
    })
  })

  test("works without a prior session", () => {
    const parsed = parseState({ short: "ab12", json: { state: "working" } })
    expect(mergeStateWithPrior({ parsed, prior: undefined }).state).toBe("working")
  })
})

describe("ageMs", () => {
  test("returns undefined for a missing createdAt", () => {
    expect(ageMs({ now: 1_000, createdAtMs: undefined })).toBeUndefined()
  })

  // The shell hands in `Date.parse(createdAt)`, which is NaN for junk input —
  // the core treats that the same as absent rather than computing a NaN age.
  test("returns undefined when the shell could not parse createdAt", () => {
    expect(ageMs({ now: 1_000, createdAtMs: Date.parse("not-a-date") })).toBeUndefined()
  })

  test("computes ms since createdAt", () => {
    const created = Date.parse("2026-01-01T00:00:00Z")
    expect(ageMs({ now: created + 5_000, createdAtMs: created })).toBe(5_000)
  })

  test("clamps negative ages to zero", () => {
    const created = Date.parse("2026-01-01T00:00:00Z")
    expect(ageMs({ now: created - 1_000, createdAtMs: created })).toBe(0)
  })
})
