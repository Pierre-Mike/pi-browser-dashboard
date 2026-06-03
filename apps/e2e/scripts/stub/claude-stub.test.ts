import { describe, expect, it } from "bun:test"
import { emptyRoster, parseDispatch, randomShort, removeWorker, upsertWorker } from "./claude-stub"

describe("parseDispatch", () => {
  it("extracts a bare positional intent", () => {
    const out = parseDispatch(["--bg", "say hello"])
    expect(out.intent).toBe("say hello")
    expect(out.agent).toBeUndefined()
    expect(out.permissionMode).toBeUndefined()
  })

  it("parses --agent and keeps intent", () => {
    const out = parseDispatch(["--bg", "--agent", "reviewer", "do the thing"])
    expect(out.agent).toBe("reviewer")
    expect(out.intent).toBe("do the thing")
  })

  it("parses --permission-mode and --session-id together", () => {
    const out = parseDispatch(["--bg", "--permission-mode", "plan", "--session-id", "abc123", "hi"])
    expect(out.permissionMode).toBe("plan")
    expect(out.sessionId).toBe("abc123")
    expect(out.intent).toBe("hi")
  })

  it("treats the last positional as intent (defensive against extra args)", () => {
    const out = parseDispatch(["--bg", "first", "actual intent"])
    expect(out.intent).toBe("actual intent")
  })
})

describe("randomShort", () => {
  it("is 8 chars from the URL-safe alphabet", () => {
    const s = randomShort()
    expect(s).toMatch(/^[a-z0-9]{8}$/)
  })

  it("is deterministic when given a seeded rng", () => {
    let i = 0
    const seq = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]
    const rng = () => seq[i++ % seq.length] as number
    expect(randomShort(rng)).toBe(randomShort(rng))
  })
})

describe("roster mutation", () => {
  it("upsertWorker adds a worker and bumps updatedAt", () => {
    const r = emptyRoster()
    const before = r.updatedAt
    // Wait at least 1ms so Date.now() advances.
    const next = upsertWorker({
      roster: r,
      short: "abc",
      worker: {
        pid: 1,
        sessionId: "s1",
        cwd: "/x",
        startedAt: 0,
        attempt: 1,
        cliVersion: "stub-0.0.0",
        dispatch: { seed: { intent: "hi" } },
      },
    })
    expect(next.workers.abc?.sessionId).toBe("s1")
    expect(next.updatedAt).toBeGreaterThanOrEqual(before)
  })

  it("removeWorker drops the entry and leaves others untouched", () => {
    const r: ReturnType<typeof emptyRoster> = {
      ...emptyRoster(),
      workers: {
        abc: {
          pid: 1,
          sessionId: "s1",
          cwd: "/x",
          startedAt: 0,
          attempt: 1,
          cliVersion: "stub",
          dispatch: { seed: { intent: "a" } },
        },
        def: {
          pid: 2,
          sessionId: "s2",
          cwd: "/y",
          startedAt: 0,
          attempt: 1,
          cliVersion: "stub",
          dispatch: { seed: { intent: "b" } },
        },
      },
    }
    const next = removeWorker(r, "abc")
    expect(next.workers.abc).toBeUndefined()
    expect(next.workers.def?.sessionId).toBe("s2")
  })
})
