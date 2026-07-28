import { describe, expect, it } from "bun:test"
import { Either } from "effect"
import type { Fleet, FleetStep } from "./fleet.core"
import {
  advance,
  chunkByConcurrency,
  createRun,
  DEFAULT_RUN_CAPS,
  findActiveRun,
  parseRunRequestBody,
  planRun,
  type Run,
  type RunCaps,
  type RunPlan,
  runSummary,
  type StepPlan,
  type StepRunState,
  type WaitOutcomeLike,
} from "./fleet-run.core"

// --- Fixtures ------------------------------------------------------------------

const fleetStep = (over: Partial<FleetStep> & { readonly id: string }): FleetStep => ({
  intent: "do it",
  n: 1,
  agent: undefined,
  cwd: undefined,
  needs: [],
  until: undefined,
  timeoutMs: undefined,
  ...over,
})

const fleet = (steps: readonly FleetStep[]): Fleet => ({ name: "f", description: undefined, steps })

const stepPlan = (over: Partial<StepPlan> & { readonly stepId: string }): StepPlan => ({
  intent: "do it",
  n: 1,
  agent: undefined,
  cwd: undefined,
  needs: [],
  until: undefined,
  timeoutMs: undefined,
  ...over,
})

const plan = (waves: ReadonlyArray<ReadonlyArray<StepPlan>>): RunPlan => ({
  fleet: "f",
  waves,
  totalSessions: waves.flat().reduce((sum, s) => sum + s.n, 0),
  maxConcurrentSpawns: 5,
})

const newRun = (p: RunPlan): Run => createRun({ id: "run-1", projectId: "proj", plan: p, now: 0 })

// Starts wave `waveIndex` (default 0) on a freshly created run — the
// "let run = newRun(p); run = advance({ run, event: WaveStarting, ... })"
// pair every advance test below needs at least once before it can observe
// anything else.
const startWave = ({
  p,
  waveIndex = 0,
  now = 1,
}: {
  readonly p: RunPlan
  readonly waveIndex?: number
  readonly now?: number
}): Run => advance({ run: newRun(p), event: { _tag: "WaveStarting", waveIndex }, now })

// Non-optional lookup: throws instead of returning `| undefined`, so call
// sites read plain fields rather than chaining `?.`.
const stepOf = (run: Run, stepId: string): StepRunState => {
  const step = run.steps.find((s) => s.stepId === stepId)
  if (step === undefined) throw new Error(`no step "${stepId}" in run`)
  return step
}

const satisfied = (waitedMs = 10): WaitOutcomeLike => ({
  _tag: "Satisfied",
  state: "done",
  waitedMs,
})

// --- parseRunRequestBody -----------------------------------------------------

describe("parseRunRequestBody", () => {
  it("defaults to a real run (dryRun: false) when the body is absent", () => {
    expect(parseRunRequestBody(undefined)).toEqual(Either.right({ dryRun: false }))
  })

  it("defaults to a real run when dryRun is omitted from an object body", () => {
    expect(parseRunRequestBody({})).toEqual(Either.right({ dryRun: false }))
  })

  it("accepts an explicit dryRun boolean", () => {
    expect(parseRunRequestBody({ dryRun: true })).toEqual(Either.right({ dryRun: true }))
    expect(parseRunRequestBody({ dryRun: false })).toEqual(Either.right({ dryRun: false }))
  })

  it("rejects a non-object body", () => {
    expect(parseRunRequestBody("nope")).toEqual(Either.left("run request body must be an object"))
    expect(parseRunRequestBody(null)).toEqual(Either.left("run request body must be an object"))
  })

  it("rejects a non-boolean dryRun", () => {
    expect(parseRunRequestBody({ dryRun: "yes" })).toEqual(Either.left("dryRun must be a boolean"))
  })
})

// --- planRun ---------------------------------------------------------------------

describe("planRun", () => {
  it("groups independent steps into a single wave and sums totalSessions", () => {
    const result = planRun({
      fleet: fleet([fleetStep({ id: "a", n: 2 }), fleetStep({ id: "b", n: 3 })]),
      caps: DEFAULT_RUN_CAPS,
    })
    expect(Either.isRight(result)).toBe(true)
    if (Either.isLeft(result)) return
    expect(result.right.waves).toHaveLength(1)
    expect(result.right.waves[0]?.map((s) => s.stepId)).toEqual(["a", "b"])
    expect(result.right.totalSessions).toBe(5)
    expect(result.right.maxConcurrentSpawns).toBe(DEFAULT_RUN_CAPS.maxConcurrentSpawns)
    expect(result.right.fleet).toBe("f")
  })

  it("orders a chain into one wave per link", () => {
    const result = planRun({
      fleet: fleet([
        fleetStep({ id: "a" }),
        fleetStep({ id: "b", needs: ["a"] }),
        fleetStep({ id: "c", needs: ["b"] }),
      ]),
      caps: DEFAULT_RUN_CAPS,
    })
    expect(Either.isRight(result)).toBe(true)
    if (Either.isLeft(result)) return
    expect(result.right.waves.map((wave) => wave.map((s) => s.stepId))).toEqual([
      ["a"],
      ["b"],
      ["c"],
    ])
  })

  it("resolves a diamond into three waves", () => {
    const result = planRun({
      fleet: fleet([
        fleetStep({ id: "a" }),
        fleetStep({ id: "b", needs: ["a"] }),
        fleetStep({ id: "c", needs: ["a"] }),
        fleetStep({ id: "d", needs: ["b", "c"] }),
      ]),
      caps: DEFAULT_RUN_CAPS,
    })
    expect(Either.isRight(result)).toBe(true)
    if (Either.isLeft(result)) return
    expect(result.right.waves.map((wave) => wave.map((s) => s.stepId))).toEqual([
      ["a"],
      ["b", "c"],
      ["d"],
    ])
  })

  it("carries every StepPlan field through from the step", () => {
    const result = planRun({
      fleet: fleet([
        fleetStep({
          id: "a",
          intent: "review",
          n: 2,
          agent: "reviewer",
          cwd: "apps/web",
          until: ["done"],
          timeoutMs: 1000,
        }),
      ]),
      caps: DEFAULT_RUN_CAPS,
    })
    expect(Either.isRight(result)).toBe(true)
    if (Either.isLeft(result)) return
    expect(result.right.waves[0]?.[0]).toEqual({
      stepId: "a",
      intent: "review",
      n: 2,
      agent: "reviewer",
      cwd: "apps/web",
      needs: [],
      until: ["done"],
      timeoutMs: 1000,
    })
  })

  it("rejects a plan whose total sessions exceed the cap, naming both numbers", () => {
    const caps: RunCaps = { maxTotalSessions: 4, maxConcurrentSpawns: 5 }
    const result = planRun({
      fleet: fleet([fleetStep({ id: "a", n: 3 }), fleetStep({ id: "b", n: 2 })]),
      caps,
    })
    expect(result).toEqual(Either.left({ _tag: "TotalSessionsExceeded", requested: 5, max: 4 }))
  })

  it("accepts a plan exactly at the cap", () => {
    const caps: RunCaps = { maxTotalSessions: 5, maxConcurrentSpawns: 5 }
    const result = planRun({ fleet: fleet([fleetStep({ id: "a", n: 5 })]), caps })
    expect(Either.isRight(result)).toBe(true)
  })
})

// --- createRun ---------------------------------------------------------------

describe("createRun", () => {
  it("starts every step pending, empty shorts, run status running", () => {
    const p = plan([[stepPlan({ stepId: "a" })], [stepPlan({ stepId: "b", needs: ["a"] })]])
    const run = newRun(p)
    expect(run.status).toBe("running")
    expect(run.finishedAt).toBeUndefined()
    expect(run.steps).toEqual([
      { stepId: "a", status: "pending", shorts: [], reason: undefined },
      { stepId: "b", status: "pending", shorts: [], reason: undefined },
    ])
  })
})

// --- advance: WaveStarting -----------------------------------------------------

describe("advance — WaveStarting", () => {
  it("moves every step in the wave with no needs to spawning", () => {
    const p = plan([[stepPlan({ stepId: "a" }), stepPlan({ stepId: "b" })]])
    const run = startWave({ p })
    expect(run.steps.map((s) => s.status)).toEqual(["spawning", "spawning"])
    expect(run.status).toBe("running")
  })

  it("skips a step whose dependency already failed, recording why", () => {
    const p = plan([[stepPlan({ stepId: "a" })], [stepPlan({ stepId: "b", needs: ["a"] })]])
    let run = startWave({ p })
    run = advance({ run, event: { _tag: "SpawnFailed", stepId: "a", reason: "boom" }, now: 2 })
    run = advance({ run, event: { _tag: "WaveStarting", waveIndex: 1 }, now: 3 })
    expect(stepOf(run, "b").status).toBe("skipped")
    expect(stepOf(run, "b").reason).toBe('dependency "a" did not complete')
  })

  it("skips a step whose dependency was itself skipped (diamond, one side fails)", () => {
    const p = plan([
      [stepPlan({ stepId: "a" })],
      [stepPlan({ stepId: "b", needs: ["a"] }), stepPlan({ stepId: "c", needs: ["a"] })],
      [stepPlan({ stepId: "d", needs: ["b", "c"] })],
    ])
    let run = startWave({ p })
    run = advance({ run, event: { _tag: "SpawnFailed", stepId: "a", reason: "boom" }, now: 2 })
    run = advance({ run, event: { _tag: "WaveStarting", waveIndex: 1 }, now: 3 })
    expect(
      run.steps
        .filter((s) => s.status === "skipped")
        .map((s) => s.stepId)
        .sort(),
    ).toEqual(["b", "c"])
    run = advance({ run, event: { _tag: "WaveStarting", waveIndex: 2 }, now: 4 })
    expect(stepOf(run, "d").status).toBe("skipped")
    expect(run.status).toBe("failed")
  })

  it("still spawns a step whose dependency succeeded", () => {
    const p = plan([[stepPlan({ stepId: "a" })], [stepPlan({ stepId: "b", needs: ["a"] })]])
    let run = startWave({ p })
    run = advance({ run, event: { _tag: "SpawnSucceeded", stepId: "a", short: "aa11" }, now: 2 })
    run = advance({ run, event: { _tag: "WaveStarting", waveIndex: 1 }, now: 3 })
    expect(stepOf(run, "b").status).toBe("spawning")
  })

  it("is a no-op for an out-of-range wave index", () => {
    const p = plan([[stepPlan({ stepId: "a" })]])
    const run = newRun(p)
    const next = advance({ run, event: { _tag: "WaveStarting", waveIndex: 5 }, now: 1 })
    expect(next.steps).toEqual(run.steps)
  })
})

// --- advance: SpawnSucceeded / SpawnFailed --------------------------------------

describe("advance — spawn outcomes", () => {
  it("a single-instance step with no until goes straight to done", () => {
    const p = plan([[stepPlan({ stepId: "a", n: 1 })]])
    const run = advance({
      run: startWave({ p }),
      event: { _tag: "SpawnSucceeded", stepId: "a", short: "aa11" },
      now: 2,
    })
    expect(stepOf(run, "a").status).toBe("done")
    expect(stepOf(run, "a").shorts).toEqual([{ short: "aa11", wait: undefined }])
    expect(run.status).toBe("done")
    expect(run.finishedAt).toBe(2)
  })

  it("stays spawning until every instance of a multi-instance step reports in", () => {
    const p = plan([[stepPlan({ stepId: "a", n: 2 })]])
    let run = advance({
      run: startWave({ p }),
      event: { _tag: "SpawnSucceeded", stepId: "a", short: "aa11" },
      now: 2,
    })
    expect(stepOf(run, "a").status).toBe("spawning")
    run = advance({ run, event: { _tag: "SpawnSucceeded", stepId: "a", short: "aa22" }, now: 3 })
    expect(stepOf(run, "a").status).toBe("done")
    expect(stepOf(run, "a").shorts.map((s) => s.short)).toEqual(["aa11", "aa22"])
  })

  it("a step with until moves to waiting once every instance has spawned", () => {
    const p = plan([[stepPlan({ stepId: "a", n: 1, until: ["done"] })]])
    const run = advance({
      run: startWave({ p }),
      event: { _tag: "SpawnSucceeded", stepId: "a", short: "aa11" },
      now: 2,
    })
    expect(stepOf(run, "a").status).toBe("waiting")
    expect(run.status).toBe("running")
  })

  it("a spawn failure fails the step and records the reason", () => {
    const p = plan([[stepPlan({ stepId: "a" })]])
    const run = advance({
      run: startWave({ p }),
      event: { _tag: "SpawnFailed", stepId: "a", reason: "ENOENT" },
      now: 2,
    })
    expect(stepOf(run, "a").status).toBe("failed")
    expect(stepOf(run, "a").reason).toBe("spawn failed: ENOENT")
    expect(run.status).toBe("failed")
  })

  it("mid-wave: a sibling spawn success is still recorded after the step already failed", () => {
    const p = plan([[stepPlan({ stepId: "a", n: 2 })]])
    let run = advance({
      run: startWave({ p }),
      event: { _tag: "SpawnFailed", stepId: "a", reason: "boom" },
      now: 2,
    })
    run = advance({ run, event: { _tag: "SpawnSucceeded", stepId: "a", short: "aa11" }, now: 3 })
    expect(stepOf(run, "a").status).toBe("failed")
    expect(stepOf(run, "a").reason).toBe("spawn failed: boom")
    expect(stepOf(run, "a").shorts).toEqual([{ short: "aa11", wait: undefined }])
  })

  it("a second SpawnFailed for the same step is a no-op (first reason wins)", () => {
    const p = plan([[stepPlan({ stepId: "a", n: 2 })]])
    let run = advance({
      run: startWave({ p }),
      event: { _tag: "SpawnFailed", stepId: "a", reason: "first" },
      now: 2,
    })
    run = advance({ run, event: { _tag: "SpawnFailed", stepId: "a", reason: "second" }, now: 3 })
    expect(stepOf(run, "a").reason).toBe("spawn failed: first")
  })
})

// --- advance: WaitResolved ------------------------------------------------------

describe("advance — WaitResolved", () => {
  const waitingRun = (n = 1): Run => {
    let run = startWave({ p: plan([[stepPlan({ stepId: "a", n, until: ["done"] })]]) })
    for (let i = 0; i < n; i++) {
      run = advance({ run, event: { _tag: "SpawnSucceeded", stepId: "a", short: `s${i}` }, now: 1 })
    }
    return run
  }

  it("a Satisfied outcome on the only short completes the step", () => {
    const run = advance({
      run: waitingRun(1),
      event: { _tag: "WaitResolved", stepId: "a", short: "s0", outcome: satisfied() },
      now: 5,
    })
    expect(stepOf(run, "a").status).toBe("done")
    expect(run.status).toBe("done")
    expect(run.finishedAt).toBe(5)
  })

  it("stays waiting until every short has a Satisfied outcome", () => {
    let run = advance({
      run: waitingRun(2),
      event: { _tag: "WaitResolved", stepId: "a", short: "s0", outcome: satisfied() },
      now: 5,
    })
    expect(stepOf(run, "a").status).toBe("waiting")
    run = advance({
      run,
      event: { _tag: "WaitResolved", stepId: "a", short: "s1", outcome: satisfied() },
      now: 6,
    })
    expect(stepOf(run, "a").status).toBe("done")
  })

  const UNSATISFIED_OUTCOMES: ReadonlyArray<{
    readonly outcome: WaitOutcomeLike
    readonly reason: string
  }> = [
    { outcome: { _tag: "Timeout", waitedMs: 600_000 }, reason: "wait timed out" },
    { outcome: { _tag: "OccupantChanged" }, reason: "session occupant changed while waiting" },
    { outcome: { _tag: "Removed" }, reason: "session was removed while waiting" },
    { outcome: { _tag: "NotFound" }, reason: "session was not found" },
  ]

  for (const { outcome, reason } of UNSATISFIED_OUTCOMES) {
    it(`a ${outcome._tag} outcome fails the step with the matching reason`, () => {
      const run = advance({
        run: waitingRun(1),
        event: { _tag: "WaitResolved", stepId: "a", short: "s0", outcome },
        now: 5,
      })
      expect(stepOf(run, "a").status).toBe("failed")
      expect(stepOf(run, "a").reason).toBe(reason)
      expect(run.status).toBe("failed")
    })
  }

  it("a later short's outcome is still recorded once the step already failed", () => {
    let run = advance({
      run: waitingRun(2),
      event: {
        _tag: "WaitResolved",
        stepId: "a",
        short: "s0",
        outcome: { _tag: "Timeout", waitedMs: 1 },
      },
      now: 5,
    })
    expect(stepOf(run, "a").status).toBe("failed")
    run = advance({
      run,
      event: { _tag: "WaitResolved", stepId: "a", short: "s1", outcome: satisfied() },
      now: 6,
    })
    expect(stepOf(run, "a").status).toBe("failed")
    const s1 = stepOf(run, "a").shorts.find((s) => s.short === "s1")
    expect(s1?.wait).toEqual(satisfied())
  })
})

// --- findActiveRun ---------------------------------------------------------------

describe("findActiveRun", () => {
  const runs = [
    { id: "r1", projectId: "p1", fleet: "review", status: "running" as const },
    { id: "r2", projectId: "p1", fleet: "fix", status: "done" as const },
    { id: "r3", projectId: "p2", fleet: "review", status: "running" as const },
  ]

  it("finds a running run for the same project + fleet", () => {
    expect(findActiveRun({ runs, projectId: "p1", fleetName: "review" })).toEqual({ runId: "r1" })
  })

  it("ignores a finished run of the same fleet", () => {
    expect(findActiveRun({ runs, projectId: "p1", fleetName: "fix" })).toBeUndefined()
  })

  it("ignores a running run of the same fleet in a different project", () => {
    expect(findActiveRun({ runs, projectId: "p9", fleetName: "review" })).toBeUndefined()
  })
})

// --- chunkByConcurrency -----------------------------------------------------------

describe("chunkByConcurrency", () => {
  it("splits into groups of at most limit", () => {
    expect(chunkByConcurrency({ items: [1, 2, 3, 4, 5], limit: 2 })).toEqual([[1, 2], [3, 4], [5]])
  })

  it("returns one chunk when items fit exactly", () => {
    expect(chunkByConcurrency({ items: [1, 2], limit: 2 })).toEqual([[1, 2]])
  })

  it("returns nothing for an empty list", () => {
    expect(chunkByConcurrency({ items: [], limit: 3 })).toEqual([])
  })

  it("treats a non-positive limit as unlimited (one chunk)", () => {
    expect(chunkByConcurrency({ items: [1, 2, 3], limit: 0 })).toEqual([[1, 2, 3]])
  })
})

// --- runSummary ------------------------------------------------------------------

describe("runSummary", () => {
  it("flattens plan + step state into wave order with every field", () => {
    const p = plan([
      [stepPlan({ stepId: "a", intent: "review", n: 2 })],
      [stepPlan({ stepId: "b", intent: "fix", needs: ["a"] })],
    ])
    let run = advance({
      run: startWave({ p }),
      event: { _tag: "SpawnSucceeded", stepId: "a", short: "aa11" },
      now: 2,
    })
    run = advance({ run, event: { _tag: "SpawnSucceeded", stepId: "a", short: "aa22" }, now: 3 })

    const summary = runSummary(run)
    expect(summary.id).toBe("run-1")
    expect(summary.projectId).toBe("proj")
    expect(summary.fleet).toBe("f")
    expect(summary.totalSessions).toBe(3)
    expect(summary.steps).toEqual([
      {
        stepId: "a",
        waveIndex: 0,
        intent: "review",
        n: 2,
        status: "done",
        shorts: [
          { short: "aa11", wait: undefined },
          { short: "aa22", wait: undefined },
        ],
        reason: undefined,
      },
      {
        stepId: "b",
        waveIndex: 1,
        intent: "fix",
        n: 1,
        status: "pending",
        shorts: [],
        reason: undefined,
      },
    ])
  })
})
