import { describe, expect, test } from "bun:test"
import { ageMs, parseRoster, parseState } from "./sessions.core"

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
