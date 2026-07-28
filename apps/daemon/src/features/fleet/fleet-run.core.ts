// Pure state machine for EXECUTING a fleet recipe: turning the wave plan
// fleet.core.ts already computes into a run — caps, the run/step status
// lattice, and the fold that turns one spawn/wait observation into the next
// run state. No I/O — the actual spawn/wait calls, the clock and id minting
// live in fleet-run.io.ts; this file only turns already-decided facts into
// decisions. Same-slice import of fleet.core.ts is fine (not a cross-slice
// hop); importing anything from features/sessions/ or platform/ is not, so
// SessionStateSlug and the wait-outcome shape below are read from fleet.core
// or mirrored here rather than imported from their real owners.

import { Either } from "effect"
import {
  type Fleet,
  type FleetStep,
  planFleetRun,
  type SessionStateSlug,
  type StepId,
} from "./fleet.core"

// Mirrors WAIT_TIMEOUT_DEFAULT_MS in
// apps/daemon/src/features/sessions/sessions-wait.core.ts — same literal-copy
// precedent fleet.core.ts already uses for WAIT_TIMEOUT_MAX_MS (see that
// file's own comment for the full rationale). Kept honest by
// scripts/mirrored-constants.test.ts.
export const WAIT_TIMEOUT_DEFAULT_MS = 30_000

// --- Caps ---------------------------------------------------------------------
//
// Running a fleet spawns real agents against the user's own subscription
// quota, so both ceilings below are hard rejections, not soft warnings — the
// same reasoning fleet.core.ts's MAX_STEP_N already applies per-step, one
// level up at the whole-run scope.

export type RunCaps = {
  // Sum of every step's `n` in the recipe. A typo'd `n` on one step is already
  // caught by MAX_STEP_N (20); this catches the same mistake spread across
  // several steps, or a recipe that is simply too large to run unattended.
  readonly maxTotalSessions: number
  // How many spawn calls the engine allows in flight at once, across every
  // step in a wave. Bounds how many `claude --bg` processes a single run can
  // start launching simultaneously — independent of maxTotalSessions, which
  // bounds the run's total size, not its burst rate.
  readonly maxConcurrentSpawns: number
}

// 50 total sessions is comfortably above this repo's own dogfood recipes
// (review-diff: 3, fix-then-verify: 2) while still catching a recipe whose
// per-step counts add up to something nobody meant to run unattended. 5
// concurrent spawns keeps a single run from launching a wave's worth of
// `claude --bg` processes all at once.
export const DEFAULT_RUN_CAPS: RunCaps = {
  maxTotalSessions: 50,
  maxConcurrentSpawns: 5,
}

export type CapViolation = {
  readonly _tag: "TotalSessionsExceeded"
  readonly requested: number
  readonly max: number
}

// --- Run request --------------------------------------------------------------

export type RunRequest = { readonly dryRun: boolean }

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)

// Validates the untrusted JSON body of POST .../fleets/:name/run. An absent
// body (or one with no `dryRun` key) defaults to a real run — dryRun has to be
// asked for explicitly, never inferred from "nothing was sent".
export const parseRunRequestBody = (raw: unknown): Either.Either<RunRequest, string> => {
  if (raw === undefined) return Either.right({ dryRun: false })
  if (!isPlainObject(raw)) return Either.left("run request body must be an object")
  if (raw.dryRun === undefined) return Either.right({ dryRun: false })
  return typeof raw.dryRun === "boolean"
    ? Either.right({ dryRun: raw.dryRun })
    : Either.left("dryRun must be a boolean")
}

// --- Plan -----------------------------------------------------------------------
//
// Everything the engine needs to run one step, flattened out of FleetStep so
// the engine never has to re-consult the original Fleet/FleetStep values.

export type StepPlan = {
  readonly stepId: StepId
  readonly intent: string
  readonly n: number
  readonly agent: string | undefined
  readonly cwd: string | undefined
  readonly needs: ReadonlyArray<StepId>
  readonly until: ReadonlyArray<SessionStateSlug> | undefined
  readonly timeoutMs: number | undefined
}

export type RunPlan = {
  readonly fleet: string
  readonly waves: ReadonlyArray<ReadonlyArray<StepPlan>>
  readonly totalSessions: number
  readonly maxConcurrentSpawns: number
}

const toStepPlan = (step: FleetStep): StepPlan => ({
  stepId: step.id,
  intent: step.intent,
  n: step.n,
  agent: step.agent,
  cwd: step.cwd,
  needs: step.needs,
  until: step.until,
  timeoutMs: step.timeoutMs,
})

// Renders the same information a dry run reports: waves, per-step session
// counts, and the total — or the single cap a request violates. Never spawns
// anything; the engine (fleet-run.io.ts) is the only place that does.
export const planRun = ({
  fleet,
  caps,
}: {
  readonly fleet: Fleet
  readonly caps: RunCaps
}): Either.Either<RunPlan, CapViolation> => {
  const totalSessions = fleet.steps.reduce((sum, step) => sum + step.n, 0)
  if (totalSessions > caps.maxTotalSessions) {
    return Either.left({
      _tag: "TotalSessionsExceeded",
      requested: totalSessions,
      max: caps.maxTotalSessions,
    })
  }
  const byId = new Map(fleet.steps.map((step) => [step.id, step] as const))
  // Cannot fail here in practice: a Fleet only exists after parseFleetFile
  // (fleet.core.ts) has already rejected any cycle among its steps — mirrors
  // fleet.routes.ts's withWaves, which makes the identical assumption for the
  // read-only /fleets endpoint.
  const waveResult = planFleetRun({ fleet })
  const waveIds = Either.isRight(waveResult) ? waveResult.right : []
  const waves = waveIds.map((wave) => wave.map((id) => toStepPlan(byId.get(id) as FleetStep)))
  return Either.right({
    fleet: fleet.name,
    waves,
    totalSessions,
    maxConcurrentSpawns: caps.maxConcurrentSpawns,
  })
}

const stepPlanOf = (plan: RunPlan, stepId: StepId): StepPlan =>
  plan.waves.flat().find((step) => step.stepId === stepId) as StepPlan

// --- Run state machine ----------------------------------------------------------

export type StepStatus = "pending" | "spawning" | "waiting" | "done" | "failed" | "skipped"
export type RunStatus = "running" | "done" | "failed"

// Mirrors WaitOutcome in
// apps/daemon/src/features/sessions/sessions-wait.io.ts field-for-field — same
// literal-copy precedent as WAIT_TIMEOUT_DEFAULT_MS above. The engine's `wait`
// port returns exactly this shape (structurally, the real WaitOutcome already
// satisfies it), so no adapter is needed at the boundary.
export type WaitOutcomeLike =
  | { readonly _tag: "Satisfied"; readonly state: SessionStateSlug; readonly waitedMs: number }
  | { readonly _tag: "Timeout"; readonly waitedMs: number }
  | { readonly _tag: "OccupantChanged" }
  | { readonly _tag: "Removed" }
  | { readonly _tag: "NotFound" }

export type ShortOutcome = {
  readonly short: string
  // undefined until this short's wait resolves, or permanently when the step
  // has no `until` at all.
  readonly wait: WaitOutcomeLike | undefined
}

export type StepRunState = {
  readonly stepId: StepId
  readonly status: StepStatus
  readonly shorts: ReadonlyArray<ShortOutcome>
  // Human-readable explanation for a "skipped" or "failed" status; undefined
  // otherwise.
  readonly reason: string | undefined
}

export type Run = {
  readonly id: string
  readonly projectId: string
  readonly plan: RunPlan
  readonly status: RunStatus
  readonly steps: ReadonlyArray<StepRunState>
  readonly startedAt: number
  readonly finishedAt: number | undefined
}

export const createRun = ({
  id,
  projectId,
  plan,
  now,
}: {
  readonly id: string
  readonly projectId: string
  readonly plan: RunPlan
  readonly now: number
}): Run => ({
  id,
  projectId,
  plan,
  status: "running",
  steps: plan.waves
    .flat()
    .map((step) => ({ stepId: step.stepId, status: "pending", shorts: [], reason: undefined })),
  startedAt: now,
  finishedAt: undefined,
})

const TERMINAL_STEP_STATUSES: ReadonlySet<StepStatus> = new Set(["done", "failed", "skipped"])

const updateStep = ({
  steps,
  stepId,
  update,
}: {
  readonly steps: ReadonlyArray<StepRunState>
  readonly stepId: StepId
  readonly update: (step: StepRunState) => StepRunState
}): ReadonlyArray<StepRunState> =>
  steps.map((step) => (step.stepId === stepId ? update(step) : step))

// --- Events -----------------------------------------------------------------
//
// One observation at a time — the engine calls `advance` once per event, so
// each handler below only ever has to reconcile a single step's state.

export type RunEvent =
  | { readonly _tag: "WaveStarting"; readonly waveIndex: number }
  | { readonly _tag: "SpawnSucceeded"; readonly stepId: StepId; readonly short: string }
  | { readonly _tag: "SpawnFailed"; readonly stepId: StepId; readonly reason: string }
  | {
      readonly _tag: "WaitResolved"
      readonly stepId: StepId
      readonly short: string
      readonly outcome: WaitOutcomeLike
    }

// A wave's steps are only ever in "pending" when their wave starts (waves are
// already ordered so a step's `needs` all live in earlier waves) — so this
// only has to decide, per step in THIS wave, whether every dependency
// finished cleanly or whether to skip instead.
const applyWaveStarting = ({
  steps,
  plan,
  waveIndex,
}: {
  readonly steps: ReadonlyArray<StepRunState>
  readonly plan: RunPlan
  readonly waveIndex: number
}): ReadonlyArray<StepRunState> => {
  const wave = plan.waves[waveIndex]
  if (!wave) return steps
  const byId = new Map(steps.map((step) => [step.stepId, step] as const))
  const idsInWave = new Set(wave.map((step) => step.stepId))
  return steps.map((step) => {
    if (step.status !== "pending" || !idsInWave.has(step.stepId)) return step
    const badDep = stepPlanOf(plan, step.stepId).needs.find((need) => {
      const dep = byId.get(need)
      return dep !== undefined && (dep.status === "failed" || dep.status === "skipped")
    })
    return badDep === undefined
      ? { ...step, status: "spawning" }
      : { ...step, status: "skipped", reason: `dependency "${badDep}" did not complete` }
  })
}

// Always records the short (even once the step is already terminal — e.g. a
// sibling instance already failed the step) so a spawned session is never
// silently dropped from the run's own trail; only advances status while the
// step is still actively spawning.
const applySpawnSucceeded = ({
  steps,
  plan,
  stepId,
  short,
}: {
  readonly steps: ReadonlyArray<StepRunState>
  readonly plan: RunPlan
  readonly stepId: StepId
  readonly short: string
}): ReadonlyArray<StepRunState> =>
  updateStep({
    steps,
    stepId,
    update: (step) => {
      const shorts = [...step.shorts, { short, wait: undefined }]
      if (step.status !== "spawning") return { ...step, shorts }
      const stepPlan = stepPlanOf(plan, stepId)
      if (shorts.length < stepPlan.n) return { ...step, shorts }
      return { ...step, shorts, status: stepPlan.until === undefined ? "done" : "waiting" }
    },
  })

const applySpawnFailed = ({
  steps,
  stepId,
  reason,
}: {
  readonly steps: ReadonlyArray<StepRunState>
  readonly stepId: StepId
  readonly reason: string
}): ReadonlyArray<StepRunState> =>
  updateStep({
    steps,
    stepId,
    update: (step) =>
      TERMINAL_STEP_STATUSES.has(step.status)
        ? step
        : { ...step, status: "failed", reason: `spawn failed: ${reason}` },
  })

const WAIT_FAILURE_REASON: Readonly<Record<Exclude<WaitOutcomeLike["_tag"], "Satisfied">, string>> =
  {
    Timeout: "wait timed out",
    OccupantChanged: "session occupant changed while waiting",
    Removed: "session was removed while waiting",
    NotFound: "session was not found",
  }

// Same always-record-then-maybe-advance shape as applySpawnSucceeded: a wait
// outcome is recorded against its short even once the step already failed
// (e.g. from a sibling short's earlier failure), so every instance's fate is
// visible in the final summary.
const applyWaitResolved = ({
  steps,
  stepId,
  short,
  outcome,
}: {
  readonly steps: ReadonlyArray<StepRunState>
  readonly stepId: StepId
  readonly short: string
  readonly outcome: WaitOutcomeLike
}): ReadonlyArray<StepRunState> =>
  updateStep({
    steps,
    stepId,
    update: (step) => {
      const shorts = step.shorts.map((so) => (so.short === short ? { ...so, wait: outcome } : so))
      if (TERMINAL_STEP_STATUSES.has(step.status)) return { ...step, shorts }
      if (outcome._tag !== "Satisfied") {
        return { ...step, shorts, status: "failed", reason: WAIT_FAILURE_REASON[outcome._tag] }
      }
      const allSatisfied = shorts.every((so) => so.wait?._tag === "Satisfied")
      return allSatisfied ? { ...step, shorts, status: "done" } : { ...step, shorts }
    },
  })

// Table dispatch rather than a switch: a 4-way switch alone already meets
// fallow's cyclomatic-5 ceiling, and this is the state machine's own event
// loop — the one place that ceiling would otherwise bite hardest. Each
// handler keeps its own narrow, fully-typed signature (see applyWaveStarting
// etc. above); only the lookup itself erases it, the same "table erases the
// per-entry type, each entry stays typed" precedent
// apps/cli/src/agent/main.ts's `HANDLERS` (keyed by Command["_tag"]) already
// establishes for dispatching a discriminated union.
type AnyEventHandler = (input: {
  readonly steps: ReadonlyArray<StepRunState>
  readonly plan: RunPlan
  // biome-ignore lint/suspicious/noExplicitAny: dispatch table intentionally erases each handler's narrowed event type — see apps/cli/src/agent/main.ts's AnyCommandHandler for the identical precedent
  readonly event: any
}) => ReadonlyArray<StepRunState>

const EVENT_HANDLERS: Readonly<Record<RunEvent["_tag"], AnyEventHandler>> = {
  WaveStarting: ({ steps, plan, event }) =>
    applyWaveStarting({ steps, plan, waveIndex: event.waveIndex }),
  SpawnSucceeded: ({ steps, plan, event }) =>
    applySpawnSucceeded({ steps, plan, stepId: event.stepId, short: event.short }),
  SpawnFailed: ({ steps, event }) =>
    applySpawnFailed({ steps, stepId: event.stepId, reason: event.reason }),
  WaitResolved: ({ steps, event }) =>
    applyWaitResolved({ steps, stepId: event.stepId, short: event.short, outcome: event.outcome }),
}

const applyEvent = ({
  steps,
  plan,
  event,
}: {
  readonly steps: ReadonlyArray<StepRunState>
  readonly plan: RunPlan
  readonly event: RunEvent
}): ReadonlyArray<StepRunState> => EVENT_HANDLERS[event._tag]({ steps, plan, event })

const deriveRunStatus = (steps: ReadonlyArray<StepRunState>): RunStatus => {
  if (!steps.every((step) => TERMINAL_STEP_STATUSES.has(step.status))) return "running"
  return steps.every((step) => step.status === "done") ? "done" : "failed"
}

// Folds one observation into the next run state: applies it to the affected
// step(s), then recomputes the run's own status from every step's status.
// `now` is the caller's clock reading, used only to stamp `finishedAt` the
// first time the run reaches a terminal status (idempotent afterwards).
export const advance = ({
  run,
  event,
  now,
}: {
  readonly run: Run
  readonly event: RunEvent
  readonly now: number
}): Run => {
  const steps = applyEvent({ steps: run.steps, plan: run.plan, event })
  const status = deriveRunStatus(steps)
  return {
    ...run,
    steps,
    status,
    finishedAt: status === "running" ? undefined : (run.finishedAt ?? now),
  }
}

// --- Twin-run guard -----------------------------------------------------------

export type ActiveRunConflict = { readonly runId: string }

// A minimal view of a run this decision needs — kept structural rather than
// importing `Run` itself so the registry can pass its live values straight in
// without an extra mapping step.
export type RunLike = {
  readonly id: string
  readonly projectId: string
  readonly fleet: string
  readonly status: RunStatus
}

export const findActiveRun = ({
  runs,
  projectId,
  fleetName,
}: {
  readonly runs: ReadonlyArray<RunLike>
  readonly projectId: string
  readonly fleetName: string
}): ActiveRunConflict | undefined => {
  const active = runs.find(
    (run) => run.projectId === projectId && run.fleet === fleetName && run.status === "running",
  )
  return active === undefined ? undefined : { runId: active.id }
}

// --- Concurrency chunking -------------------------------------------------------

// Splits a wave's flattened spawn tasks into groups of at most `limit`; the
// engine awaits one group fully before starting the next, which is what
// actually bounds `maxConcurrentSpawns` in practice. A non-positive limit is
// treated as "no limit" (one chunk) rather than a divide-by-zero.
export const chunkByConcurrency = <T>({
  items,
  limit,
}: {
  readonly items: ReadonlyArray<T>
  readonly limit: number
}): ReadonlyArray<ReadonlyArray<T>> => {
  if (items.length === 0) return []
  if (limit <= 0) return [items]
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += limit) chunks.push(items.slice(i, i + limit))
  return chunks
}

// --- Summary ------------------------------------------------------------------

export type StepSummary = {
  readonly stepId: StepId
  readonly waveIndex: number
  readonly intent: string
  readonly n: number
  readonly status: StepStatus
  readonly shorts: ReadonlyArray<ShortOutcome>
  readonly reason: string | undefined
}

export type RunSummary = {
  readonly id: string
  readonly projectId: string
  readonly fleet: string
  readonly status: RunStatus
  readonly totalSessions: number
  readonly startedAt: number
  readonly finishedAt: number | undefined
  readonly steps: ReadonlyArray<StepSummary>
}

// Flattens plan + step-state back into one array in wave order — what the CLI
// prints and the GET endpoints return.
export const runSummary = (run: Run): RunSummary => {
  const stateById = new Map(run.steps.map((step) => [step.stepId, step] as const))
  return {
    id: run.id,
    projectId: run.projectId,
    fleet: run.plan.fleet,
    status: run.status,
    totalSessions: run.plan.totalSessions,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    steps: run.plan.waves.flatMap((wave, waveIndex) =>
      wave.map((stepPlan) => {
        const state = stateById.get(stepPlan.stepId) as StepRunState
        return {
          stepId: stepPlan.stepId,
          waveIndex,
          intent: stepPlan.intent,
          n: stepPlan.n,
          status: state.status,
          shorts: state.shorts,
          reason: state.reason,
        }
      }),
    ),
  }
}
