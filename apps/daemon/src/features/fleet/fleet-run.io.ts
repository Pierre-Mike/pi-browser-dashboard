// Imperative engine for executing a fleet run: walks a RunPlan's waves,
// dispatching each wave's spawns through injected ports and waiting on any
// step's `until`, publishing a `fleet.run` SSE event on every transition.
//
// The fleet slice must not import the sessions slice or platform/shell.io
// directly — every effectful capability the engine needs is therefore a
// plain function type (FleetRunPorts below) rather than an Effect service;
// api.ts (outside any slice) wires the real ShellIo/SessionWaitIo into it.
// Plain async functions closing over a private Map, not an Effect service —
// mirrors fleet.io.ts's own choice (see that file's comment) and sse-bus.ts's
// createBus()/sseBus split: a factory for tests, one shared instance for
// production.
//
// Runs live in memory only, like everything else this daemon holds (see
// AGENTS.md/CLAUDE.md: "Stateless — supervisor owns processes, worktrees, and
// persistence"). A daemon restart loses a run's own bookkeeping, but the
// sessions it already spawned keep existing and stay visible via
// GET /sessions regardless of that loss — recording a spawned short
// (SpawnSucceeded) before its wait starts is what lets a caller find it again
// through THIS run's own GET endpoint even if the daemon dies mid-wait.

import { join } from "node:path"
import { sseBus } from "../../platform/sse-bus"
import type { SessionStateSlug } from "./fleet.core"
import {
  advance,
  chunkByConcurrency,
  createRun,
  findActiveRun,
  type Run,
  type RunEvent,
  type RunPlan,
  type RunSummary,
  runSummary,
  type StepPlan,
  WAIT_TIMEOUT_DEFAULT_MS,
  type WaitOutcomeLike,
} from "./fleet-run.core"

// --- Ports ----------------------------------------------------------------------

export type FleetSpawnInput = {
  readonly intent: string
  readonly agent?: string
  readonly cwd?: string
}

export type FleetWaitInput = {
  readonly short: string
  readonly until: ReadonlyArray<SessionStateSlug>
  readonly timeoutMs: number
}

export type FleetRunPorts = {
  // Resolves the short id of the newly spawned session, or rejects — the
  // engine turns a rejection into a SpawnFailed event rather than crashing.
  readonly spawn: (input: FleetSpawnInput) => Promise<string>
  // Resolves once the pinned wait settles; the real SessionWaitIo.wait Effect
  // has no failure channel, so this is not expected to reject.
  readonly wait: (input: FleetWaitInput) => Promise<WaitOutcomeLike>
  readonly now: () => number
  readonly newRunId: () => string
}

// --- Registry --------------------------------------------------------------------

export type StartRunInput = {
  readonly projectId: string
  readonly projectRoot: string
  readonly plan: RunPlan
  readonly ports: FleetRunPorts
}

export type StartRunResult =
  | { readonly _tag: "Started"; readonly runId: string }
  | { readonly _tag: "AlreadyActive"; readonly runId: string }

export type FleetRunRegistry = {
  readonly startRun: (input: StartRunInput) => StartRunResult
  readonly getRun: (input: {
    readonly projectId: string
    readonly runId: string
  }) => RunSummary | undefined
  readonly listRuns: (input: { readonly projectId: string }) => ReadonlyArray<RunSummary>
}

const resolveCwd = ({
  projectRoot,
  stepPlan,
}: {
  readonly projectRoot: string
  readonly stepPlan: StepPlan
}): string => (stepPlan.cwd === undefined ? projectRoot : join(projectRoot, stepPlan.cwd))

export const createFleetRunRegistry = (): FleetRunRegistry => {
  const runs = new Map<string, Run>()

  const applyAdvance = ({
    id,
    event,
    ports,
  }: {
    readonly id: string
    readonly event: RunEvent
    readonly ports: FleetRunPorts
  }): Run => {
    const current = runs.get(id)
    if (current === undefined) {
      // Defensive only: every caller below only ever advances a run this same
      // registry just created, and no other code can delete one.
      throw new Error(`fleet run "${id}" is not registered`)
    }
    const next = advance({ run: current, event, now: ports.now() })
    runs.set(id, next)
    sseBus.publish({ type: "fleet.run", data: runSummary(next) })
    return next
  }

  // One instance's spawn call. Never throws: a rejection becomes a
  // SpawnFailed event and `undefined`, so one task's failure cannot abort its
  // wave's Promise.all. Returns the short on success, so the caller knows
  // whether there is anything left to wait on.
  const spawnOneInstance = async ({
    id,
    stepPlan,
    projectRoot,
    ports,
  }: {
    readonly id: string
    readonly stepPlan: StepPlan
    readonly projectRoot: string
    readonly ports: FleetRunPorts
  }): Promise<string | undefined> => {
    try {
      const short = await ports.spawn({
        intent: stepPlan.intent,
        agent: stepPlan.agent,
        cwd: resolveCwd({ projectRoot, stepPlan }),
      })
      applyAdvance({ id, event: { _tag: "SpawnSucceeded", stepId: stepPlan.stepId, short }, ports })
      return short
    } catch (err) {
      applyAdvance({
        id,
        event: {
          _tag: "SpawnFailed",
          stepId: stepPlan.stepId,
          reason: err instanceof Error ? err.message : String(err),
        },
        ports,
      })
      return undefined
    }
  }

  // The pinned wait for one already-spawned short. Only called once a step
  // has both a short (spawn succeeded) and an `until` to wait for.
  const waitOneInstance = async ({
    id,
    stepPlan,
    short,
    ports,
  }: {
    readonly id: string
    readonly stepPlan: StepPlan
    readonly short: string
    readonly ports: FleetRunPorts
  }): Promise<void> => {
    const outcome = await ports.wait({
      short,
      // Only called when stepPlan.until is set (see runOneSpawn below).
      until: stepPlan.until as ReadonlyArray<SessionStateSlug>,
      timeoutMs: stepPlan.timeoutMs ?? WAIT_TIMEOUT_DEFAULT_MS,
    })
    applyAdvance({
      id,
      event: { _tag: "WaitResolved", stepId: stepPlan.stepId, short, outcome },
      ports,
    })
  }

  // One instance's full lifecycle: spawn, then its pinned wait if the step
  // declares one.
  const runOneSpawn = async ({
    id,
    stepPlan,
    projectRoot,
    ports,
  }: {
    readonly id: string
    readonly stepPlan: StepPlan
    readonly projectRoot: string
    readonly ports: FleetRunPorts
  }): Promise<void> => {
    const short = await spawnOneInstance({ id, stepPlan, projectRoot, ports })
    if (short === undefined) return
    if (stepPlan.until === undefined) return
    await waitOneInstance({ id, stepPlan, short, ports })
  }

  const spawningStepPlans = ({
    run,
    plan,
  }: {
    readonly run: Run
    readonly plan: RunPlan
  }): ReadonlyArray<StepPlan> => {
    const spawningIds = new Set(
      run.steps.filter((step) => step.status === "spawning").map((step) => step.stepId),
    )
    return plan.waves.flat().filter((step) => spawningIds.has(step.stepId))
  }

  // One wave: mark its eligible steps spawning (or skipped), then run every
  // instance of every now-spawning step through runOneSpawn, chunked so no
  // more than plan.maxConcurrentSpawns are ever in flight at once. The next
  // wave does not start until every chunk here — spawn AND its wait — has
  // settled, which is also what bounds concurrent spawns to the chunk size:
  // a wait is cheap for the daemon to hold open, but the chunk boundary still
  // caps how many `claude --bg` processes this wave can have launched by any
  // given moment.
  const executeWave = async ({
    id,
    plan,
    projectRoot,
    ports,
    waveIndex,
  }: {
    readonly id: string
    readonly plan: RunPlan
    readonly projectRoot: string
    readonly ports: FleetRunPorts
    readonly waveIndex: number
  }): Promise<void> => {
    const afterStart = applyAdvance({ id, event: { _tag: "WaveStarting", waveIndex }, ports })
    const tasks = spawningStepPlans({ run: afterStart, plan }).flatMap((stepPlan) =>
      Array.from({ length: stepPlan.n }, () => stepPlan),
    )
    const chunks = chunkByConcurrency({ items: tasks, limit: plan.maxConcurrentSpawns })
    for (const chunk of chunks) {
      await Promise.all(chunk.map((stepPlan) => runOneSpawn({ id, stepPlan, projectRoot, ports })))
    }
  }

  const executeRun = async ({
    id,
    plan,
    projectRoot,
    ports,
  }: {
    readonly id: string
    readonly plan: RunPlan
    readonly projectRoot: string
    readonly ports: FleetRunPorts
  }): Promise<void> => {
    for (let waveIndex = 0; waveIndex < plan.waves.length; waveIndex++) {
      await executeWave({ id, plan, projectRoot, ports, waveIndex })
    }
  }

  return {
    startRun: ({ projectId, projectRoot, plan, ports }) => {
      const runLikes = [...runs.values()].map((run) => ({
        id: run.id,
        projectId: run.projectId,
        fleet: run.plan.fleet,
        status: run.status,
      }))
      const conflict = findActiveRun({ runs: runLikes, projectId, fleetName: plan.fleet })
      if (conflict !== undefined) return { _tag: "AlreadyActive", runId: conflict.runId }
      const id = ports.newRunId()
      const run = createRun({ id, projectId, plan, now: ports.now() })
      runs.set(id, run)
      sseBus.publish({ type: "fleet.run", data: runSummary(run) })
      // Fire-and-forget: the route has already returned 202 with this run's
      // id by the time any of this settles. A rejection here can only be a
      // programmer error inside the engine itself — every real spawn/wait
      // failure already becomes an event inside runOneSpawn — so this only
      // logs, it never crashes the daemon.
      void executeRun({ id, plan, projectRoot, ports }).catch((err: unknown) => {
        console.error(`[fleet-run] run "${id}" crashed`, err)
      })
      return { _tag: "Started", runId: id }
    },
    getRun: ({ projectId, runId }) => {
      const run = runs.get(runId)
      return run !== undefined && run.projectId === projectId ? runSummary(run) : undefined
    },
    listRuns: ({ projectId }) =>
      [...runs.values()].filter((run) => run.projectId === projectId).map(runSummary),
  }
}

// Shared production instance — api.ts wires this into fleet.routes.ts, the
// same way platform/sse-bus.ts exports one shared `sseBus`.
export const fleetRunRegistry: FleetRunRegistry = createFleetRunRegistry()
