/**
 * Producer-side contract test: what `sessions.core` actually emits must satisfy
 * the published `SessionState` contract in `@pid/shared`.
 *
 * The daemon keeps its own strict declaration of `SessionState` — every field a
 * *required* key, so a constructor that forgets one is a type error — while the
 * shared contract models *wire* optionality, because `JSON.stringify` drops
 * `undefined` keys and they simply do not appear in the response body. Two
 * declarations for two different jobs is fine; two declarations that can
 * silently disagree is not. This test is the link: it JSON round-trips real
 * `parseState` / `seedFromWorker` output and decodes it with the shared
 * decoder, whose `onExcessProperty: "error"` fails on a field the daemon added
 * and the contract does not know about.
 *
 * Add a field to the daemon's SessionState without adding it to
 * `shared/src/session.ts` and this test goes red — which is exactly what nobody
 * noticed for as long as `apps/web` kept a hand-written mirror instead.
 */
import { describe, expect, it } from "bun:test"
import { decodeSessionState } from "@pid/shared"
import { parseState, type RosterWorker, seedFromWorker } from "./sessions.core"

/** The wire is JSON: undefined-valued keys never reach the client. */
const overTheWire = (value: unknown): unknown => JSON.parse(JSON.stringify(value))

describe("the daemon's SessionState satisfies the published contract", () => {
  it("accepts a state.json-sourced session", () => {
    const state = parseState({
      short: "abc123",
      json: {
        state: "working",
        detail: "editing",
        tempo: "steady",
        intent: "ship it",
        name: "feat/x",
        sessionId: "s-1",
        cwd: "/tmp/x",
        createdAt: "2026-07-29T00:00:00.000Z",
        updatedAt: "2026-07-29T00:01:00.000Z",
        linkScanPath: "/tmp/x/log",
        worktreePath: "/tmp/x/.wt",
        worktreeBranch: "feat/x",
        output: { result: { exitCode: 0 } },
      },
    })
    const decoded = decodeSessionState(overTheWire(state))
    expect(decoded.short).toBe("abc123")
    expect(decoded.state).toBe("working")
    expect(decoded.source).toBe("state.json")
    expect(decoded.worktreeBranch).toBe("feat/x")
  })

  it("accepts a minimal state.json — every optional field absent", () => {
    const decoded = decodeSessionState(overTheWire(parseState({ short: "abc123", json: {} })))
    expect(decoded.state).toBe("idle")
    expect(decoded.detail).toBeUndefined()
  })

  it("accepts an unrecognized slug degraded to `unknown`", () => {
    const state = parseState({ short: "abc123", json: { state: "compacting" } })
    const decoded = decodeSessionState(overTheWire(state))
    expect(decoded.state).toBe("unknown")
    expect(decoded.degradedFrom).toBe("compacting")
  })

  it("accepts a roster-seeded session", () => {
    const worker: RosterWorker = {
      short: "def456",
      pid: 42,
      sessionId: "s-2",
      cwd: "/tmp/y",
      intent: "do the thing",
      startedAt: 1_753_000_000_000,
      agent: "claude",
    }
    const decoded = decodeSessionState(overTheWire(seedFromWorker(worker)))
    expect(decoded.source).toBe("roster-seed")
    expect(decoded.short).toBe("def456")
  })
})
