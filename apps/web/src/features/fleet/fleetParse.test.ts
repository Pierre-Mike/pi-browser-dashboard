import { describe, expect, test } from "bun:test"
import {
  parseFleetRunsResponse,
  parseFleetsResponse,
  parseRunAttempt,
  parseRunSummary,
} from "./fleetParse"

describe("parseFleetsResponse", () => {
  test("decodes a valid recipe's fleets, steps and waves", () => {
    const wire = {
      fleets: [
        {
          name: "review-and-fix",
          description: "three reviewers, then one fixer",
          steps: [
            { id: "review", intent: "review the diff", n: 3 },
            { id: "fix", intent: "fix findings", needs: ["review"] },
          ],
          waves: [["review"], ["fix"]],
        },
      ],
      errors: [],
    }
    const result = parseFleetsResponse(wire)
    expect(result.errors).toEqual([])
    expect(result.fleets).toHaveLength(1)
    expect(result.fleets[0]?.name).toBe("review-and-fix")
    expect(result.fleets[0]?.waves).toEqual([["review"], ["fix"]])
    expect(result.fleets[0]?.steps).toEqual([
      {
        id: "review",
        intent: "review the diff",
        n: 3,
        agent: undefined,
        cwd: undefined,
        needs: [],
        until: undefined,
        timeoutMs: undefined,
      },
      {
        id: "fix",
        intent: "fix findings",
        n: 1,
        agent: undefined,
        cwd: undefined,
        needs: ["review"],
        until: undefined,
        timeoutMs: undefined,
      },
    ])
  })

  test("decodes a whole-file validation error list", () => {
    const wire = {
      fleets: [],
      errors: [{ fleet: "bad", step: "a", message: 'duplicate step id: "a"' }],
    }
    const result = parseFleetsResponse(wire)
    expect(result.fleets).toEqual([])
    expect(result.errors).toEqual([{ fleet: "bad", step: "a", message: 'duplicate step id: "a"' }])
  })

  test("degrades an unrecognisable body to empty rather than throwing", () => {
    expect(parseFleetsResponse(null)).toEqual({ fleets: [], errors: [] })
    expect(parseFleetsResponse("not an object")).toEqual({ fleets: [], errors: [] })
    expect(parseFleetsResponse({})).toEqual({ fleets: [], errors: [] })
  })

  test("drops a malformed fleet entry rather than crashing on the whole array", () => {
    const wire = { fleets: [{ name: "ok", steps: [] }, { no: "name" }, "garbage"], errors: [] }
    const result = parseFleetsResponse(wire)
    expect(result.fleets).toHaveLength(1)
    expect(result.fleets[0]?.name).toBe("ok")
  })
})

describe("parseRunAttempt", () => {
  test("decodes a dry-run plan (200, dryRun: true)", () => {
    const result = parseRunAttempt({
      status: 200,
      body: {
        dryRun: true,
        plan: {
          fleet: "review-and-fix",
          waves: [[{ id: "review", intent: "review", n: 3 }]],
          totalSessions: 3,
          maxConcurrentSpawns: 5,
        },
      },
    })
    expect(result._tag).toBe("DryRun")
    if (result._tag === "DryRun") {
      expect(result.plan.totalSessions).toBe(3)
      expect(result.plan.waves).toHaveLength(1)
      expect(result.plan.waves[0]?.[0]?.id).toBe("review")
    }
  })

  test("decodes a started real run (202)", () => {
    const result = parseRunAttempt({
      status: 202,
      body: { runId: "run-1", waves: [[{ id: "a", intent: "x", n: 1 }]], totalSessions: 1 },
    })
    expect(result).toEqual({
      _tag: "Started",
      runId: "run-1",
      waves: [
        [
          {
            id: "a",
            intent: "x",
            n: 1,
            agent: undefined,
            cwd: undefined,
            needs: [],
            until: undefined,
            timeoutMs: undefined,
          },
        ],
      ],
      totalSessions: 1,
    })
  })

  test("decodes an already-active conflict (409)", () => {
    expect(
      parseRunAttempt({ status: 409, body: { error: "already_active", runId: "run-9" } }),
    ).toEqual({ _tag: "AlreadyActive", runId: "run-9" })
  })

  test("decodes a cap violation (400)", () => {
    expect(
      parseRunAttempt({
        status: 400,
        body: {
          error: "cap_exceeded",
          violation: { _tag: "TotalSessionsExceeded", requested: 90, max: 50 },
        },
      }),
    ).toEqual({ _tag: "CapExceeded", requested: 90, max: 50 })
  })

  test("decodes an invalid recipe (400)", () => {
    const result = parseRunAttempt({
      status: 400,
      body: {
        error: "invalid_recipe",
        errors: [{ fleet: "bad", step: undefined, message: "boom" }],
      },
    })
    expect(result).toEqual({
      _tag: "InvalidRecipe",
      errors: [{ fleet: "bad", step: undefined, message: "boom" }],
    })
  })

  test("decodes an invalid body (400)", () => {
    expect(
      parseRunAttempt({
        status: 400,
        body: { error: "invalid_body", message: "dryRun must be a boolean" },
      }),
    ).toEqual({ _tag: "InvalidBody", message: "dryRun must be a boolean" })
  })

  test("decodes not-found (404)", () => {
    expect(parseRunAttempt({ status: 404, body: { error: "not_found" } })).toEqual({
      _tag: "NotFound",
    })
  })

  test("falls back to UnknownError for anything else", () => {
    expect(parseRunAttempt({ status: 500, body: undefined })).toEqual({
      _tag: "UnknownError",
      status: 500,
    })
  })
})

describe("parseRunSummary / parseFleetRunsResponse", () => {
  const rawRun = {
    id: "run-1",
    projectId: "proj-1",
    fleet: "review-and-fix",
    status: "running",
    totalSessions: 4,
    startedAt: 1000,
    finishedAt: undefined,
    steps: [
      {
        stepId: "review",
        waveIndex: 0,
        intent: "review the diff",
        n: 3,
        status: "spawning",
        shorts: [{ short: "abc123", wait: undefined }],
        reason: undefined,
      },
      {
        stepId: "fix",
        waveIndex: 1,
        intent: "fix findings",
        n: 1,
        status: "skipped",
        shorts: [],
        reason: 'dependency "review" did not complete',
      },
    ],
  }

  test("decodes a full run summary, including wait outcomes and skip reasons", () => {
    const run = parseRunSummary(rawRun)
    expect(run?.status).toBe("running")
    expect(run?.steps[0]?.shorts[0]?.short).toBe("abc123")
    expect(run?.steps[1]?.status).toBe("skipped")
    expect(run?.steps[1]?.reason).toBe('dependency "review" did not complete')
  })

  test("decodes every wait outcome tag", () => {
    const withWait = (wait: unknown) =>
      parseRunSummary({
        ...rawRun,
        steps: [{ ...rawRun.steps[0], shorts: [{ short: "s1", wait }] }],
      })?.steps[0]?.shorts[0]?.wait

    expect(withWait({ _tag: "Satisfied", state: "done", waitedMs: 500 })).toEqual({
      _tag: "Satisfied",
      state: "done",
      waitedMs: 500,
    })
    expect(withWait({ _tag: "Timeout", waitedMs: 60000 })).toEqual({
      _tag: "Timeout",
      waitedMs: 60000,
    })
    expect(withWait({ _tag: "OccupantChanged" })).toEqual({ _tag: "OccupantChanged" })
    expect(withWait({ _tag: "Removed" })).toEqual({ _tag: "Removed" })
    expect(withWait({ _tag: "NotFound" })).toEqual({ _tag: "NotFound" })
    expect(withWait({ _tag: "Bogus" })).toBeUndefined()
  })

  test("rejects a run missing required fields", () => {
    expect(parseRunSummary({ id: "x" })).toBeUndefined()
    expect(parseRunSummary(null)).toBeUndefined()
    expect(parseRunSummary({ ...rawRun, status: "bogus" })).toBeUndefined()
  })

  test("parseFleetRunsResponse unwraps the {runs} envelope", () => {
    expect(parseFleetRunsResponse({ runs: [rawRun] })).toHaveLength(1)
    expect(parseFleetRunsResponse({})).toEqual([])
    expect(parseFleetRunsResponse(null)).toEqual([])
  })
})
