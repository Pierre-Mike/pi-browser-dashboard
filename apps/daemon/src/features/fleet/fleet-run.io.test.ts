import { describe, expect, it } from "bun:test"
import type { RunPlan, RunSummary, StepPlan, StepSummary, WaitOutcomeLike } from "./fleet-run.core"
import { createFleetRunRegistry, type FleetRunPorts, type FleetRunRegistry } from "./fleet-run.io"

const PROJECT = "proj"

const stepPlan = (over: Partial<StepPlan> & { readonly stepId: string }): StepPlan => ({
  intent: `intent for ${over.stepId}`,
  n: 1,
  agent: undefined,
  cwd: undefined,
  needs: [],
  until: undefined,
  timeoutMs: undefined,
  ...over,
})

const plan = (
  waves: ReadonlyArray<ReadonlyArray<StepPlan>>,
  over: Partial<Pick<RunPlan, "maxConcurrentSpawns" | "fleet">> = {},
): RunPlan => ({
  fleet: "f",
  waves,
  totalSessions: waves.flat().reduce((sum, s) => sum + s.n, 0),
  maxConcurrentSpawns: 5,
  ...over,
})

// Real timers, not fake ones: the engine's own concurrency chunking is
// exercised through actual async scheduling, so tests wait for completion by
// polling rather than by advancing a clock.
const waitUntil = async (predicate: () => boolean, timeoutMs = 2000): Promise<void> => {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs)
      throw new Error("waitUntil: timed out waiting for condition")
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

let runIdCounter = 0
let shortCounter = 0

const satisfied = (): WaitOutcomeLike => ({ _tag: "Satisfied", state: "done", waitedMs: 1 })

const makePorts = (over: Partial<FleetRunPorts> = {}): FleetRunPorts => ({
  now: () => Date.now(),
  newRunId: () => `run-${++runIdCounter}`,
  spawn: async () => `short-${++shortCounter}`,
  wait: async () => satisfied(),
  ...over,
})

// Starts a run and returns its id, failing loudly if the registry refused to
// start it (every test here expects a fresh project + fleet pairing, so a
// refusal always means a test bug, not a case under test).
const start = ({
  registry,
  plan: runPlan,
  ports,
  projectId = PROJECT,
}: {
  readonly registry: FleetRunRegistry
  readonly plan: RunPlan
  readonly ports: FleetRunPorts
  readonly projectId?: string
}): string => {
  const started = registry.startRun({ projectId, projectRoot: "/root", plan: runPlan, ports })
  if (started._tag !== "Started") throw new Error(`expected Started, got ${started._tag}`)
  return started.runId
}

// Polls until the run leaves the map's "running" status (or a caller-given
// predicate over its live summary holds), then returns the final summary —
// never `| undefined`, so every call site below reads plain fields.
const runToCompletion = async ({
  registry,
  runId,
  projectId = PROJECT,
}: {
  readonly registry: FleetRunRegistry
  readonly runId: string
  readonly projectId?: string
}): Promise<RunSummary> => {
  await waitUntil(() => registry.getRun({ projectId, runId })?.status !== "running")
  const summary = registry.getRun({ projectId, runId })
  if (summary === undefined) throw new Error(`run "${runId}" vanished`)
  return summary
}

const stepOf = (summary: RunSummary, stepId: string): StepSummary => {
  const step = summary.steps.find((s) => s.stepId === stepId)
  if (step === undefined) throw new Error(`no step "${stepId}" in run summary`)
  return step
}

describe("fleet-run.io — createFleetRunRegistry", () => {
  it("executes a chain in wave order and reaches done", async () => {
    const registry = createFleetRunRegistry()
    const p = plan([
      [stepPlan({ stepId: "a" })],
      [stepPlan({ stepId: "b", needs: ["a"], until: ["done"] })],
    ])
    const runId = start({ registry, plan: p, ports: makePorts() })
    const summary = await runToCompletion({ registry, runId })
    expect(summary.status).toBe("done")
    expect(summary.steps.map((s) => s.status)).toEqual(["done", "done"])
    expect(summary.steps.every((s) => s.shorts.length === 1)).toBe(true)
  })

  it("diamond: a failed spawn on one side skips its dependent, the other side still succeeds", async () => {
    const registry = createFleetRunRegistry()
    const p = plan([
      [stepPlan({ stepId: "a" })],
      [stepPlan({ stepId: "b", needs: ["a"] }), stepPlan({ stepId: "c", needs: ["a"] })],
      [stepPlan({ stepId: "d", needs: ["b", "c"] })],
    ])
    const failingSpawn: FleetRunPorts["spawn"] = async ({ intent }) => {
      if (intent.includes("b")) throw new Error("boom")
      return `short-${++shortCounter}`
    }
    const runId = start({ registry, plan: p, ports: makePorts({ spawn: failingSpawn }) })
    const summary = await runToCompletion({ registry, runId })
    expect(summary.status).toBe("failed")
    expect(stepOf(summary, "a").status).toBe("done")
    expect(stepOf(summary, "b").status).toBe("failed")
    expect(stepOf(summary, "b").reason).toBe("spawn failed: boom")
    expect(stepOf(summary, "c").status).toBe("done")
    expect(stepOf(summary, "d").status).toBe("skipped")
  })

  it("a wait timeout fails the step", async () => {
    const registry = createFleetRunRegistry()
    const p = plan([[stepPlan({ stepId: "a", until: ["done"], timeoutMs: 1000 })]])
    const timeoutWait: FleetRunPorts["wait"] = async () => ({ _tag: "Timeout", waitedMs: 1000 })
    const runId = start({ registry, plan: p, ports: makePorts({ wait: timeoutWait }) })
    const summary = await runToCompletion({ registry, runId })
    expect(summary.status).toBe("failed")
    expect(stepOf(summary, "a").status).toBe("failed")
    expect(stepOf(summary, "a").reason).toBe("wait timed out")
  })

  it("a spawn rejection is recorded as a failure rather than crashing the run", async () => {
    const registry = createFleetRunRegistry()
    const p = plan([[stepPlan({ stepId: "a" })]])
    const rejectingSpawn: FleetRunPorts["spawn"] = async () => {
      throw new Error("ENOENT: claude not found")
    }
    const runId = start({ registry, plan: p, ports: makePorts({ spawn: rejectingSpawn }) })
    const summary = await runToCompletion({ registry, runId })
    expect(summary.status).toBe("failed")
    expect(stepOf(summary, "a").reason).toBe("spawn failed: ENOENT: claude not found")
  })

  it("resolves the short before the wait starts, so it is visible mid-run", async () => {
    const registry = createFleetRunRegistry()
    const p = plan([[stepPlan({ stepId: "a", until: ["done"] })]])
    let releaseWait: (() => void) | undefined
    const waitGate = new Promise<void>((resolve) => {
      releaseWait = resolve
    })
    const gatedWait: FleetRunPorts["wait"] = async () => {
      await waitGate
      return satisfied()
    }
    const runId = start({ registry, plan: p, ports: makePorts({ wait: gatedWait }) })
    await waitUntil(
      () => registry.getRun({ projectId: PROJECT, runId })?.steps[0]?.status === "waiting",
    )
    const midRun = registry.getRun({ projectId: PROJECT, runId })
    if (midRun === undefined) throw new Error("run vanished")
    expect(stepOf(midRun, "a").shorts).toHaveLength(1)
    releaseWait?.()
    await runToCompletion({ registry, runId })
  })

  it("never exceeds maxConcurrentSpawns in-flight spawn calls", async () => {
    const registry = createFleetRunRegistry()
    const p = plan([[stepPlan({ stepId: "a", n: 6 })]], { maxConcurrentSpawns: 2 })
    let active = 0
    let maxActive = 0
    const throttledSpawn: FleetRunPorts["spawn"] = async () => {
      active += 1
      maxActive = Math.max(maxActive, active)
      await new Promise((resolve) => setTimeout(resolve, 20))
      active -= 1
      return `short-${++shortCounter}`
    }
    const runId = start({ registry, plan: p, ports: makePorts({ spawn: throttledSpawn }) })
    await runToCompletion({ registry, runId })
    expect(maxActive).toBeLessThanOrEqual(2)
    expect(maxActive).toBeGreaterThan(0)
  })

  it("refuses a second run of the same project + fleet while one is active", async () => {
    const registry = createFleetRunRegistry()
    const p = plan([[stepPlan({ stepId: "a" })]])
    let releaseSpawn: (() => void) | undefined
    const spawnGate = new Promise<void>((resolve) => {
      releaseSpawn = resolve
    })
    const gatedSpawn: FleetRunPorts["spawn"] = async () => {
      await spawnGate
      return `short-${++shortCounter}`
    }
    const firstRunId = start({ registry, plan: p, ports: makePorts({ spawn: gatedSpawn }) })
    const second = registry.startRun({
      projectId: PROJECT,
      projectRoot: "/root",
      plan: p,
      ports: makePorts(),
    })
    expect(second).toEqual({ _tag: "AlreadyActive", runId: firstRunId })
    releaseSpawn?.()
    await runToCompletion({ registry, runId: firstRunId })
  })

  it("allows a new run of the same fleet once the previous one finished", async () => {
    const registry = createFleetRunRegistry()
    const p = plan([[stepPlan({ stepId: "a" })]])
    const firstRunId = start({ registry, plan: p, ports: makePorts() })
    await runToCompletion({ registry, runId: firstRunId })
    const second = registry.startRun({
      projectId: PROJECT,
      projectRoot: "/root",
      plan: p,
      ports: makePorts(),
    })
    expect(second._tag).toBe("Started")
  })

  it("getRun / listRuns are scoped to their own project", async () => {
    const registry = createFleetRunRegistry()
    const p = plan([[stepPlan({ stepId: "a" })]])
    const runId = start({ registry, plan: p, ports: makePorts(), projectId: "p1" })
    await runToCompletion({ registry, runId, projectId: "p1" })
    expect(registry.getRun({ projectId: "p2", runId })).toBeUndefined()
    expect(registry.listRuns({ projectId: "p1" })).toHaveLength(1)
    expect(registry.listRuns({ projectId: "p2" })).toHaveLength(0)
  })
})
