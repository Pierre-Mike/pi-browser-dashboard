import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createApp } from "./fleet.routes"
import type { RunCaps } from "./fleet-run.core"
import { createFleetRunRegistry, type FleetRunPorts, type FleetRunRegistry } from "./fleet-run.io"

let root: string

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "fleet-routes-"))

  await mkdir(join(root, "empty"), { recursive: true })

  await mkdir(join(root, "valid", ".pid"), { recursive: true })
  await writeFile(
    join(root, "valid", ".pid", "fleet.json"),
    JSON.stringify({
      fleets: [
        {
          name: "review-and-fix",
          description: "three reviewers, then one fixer",
          steps: [
            { id: "review", intent: "review the working diff for bugs", n: 3 },
            { id: "fix", intent: "fix what the reviewers found", needs: ["review"] },
          ],
        },
      ],
    }),
  )

  await mkdir(join(root, "broken", ".pid"), { recursive: true })
  await writeFile(
    join(root, "broken", ".pid", "fleet.json"),
    JSON.stringify({
      fleets: [
        {
          name: "bad",
          steps: [
            { id: "a", intent: "do a thing" },
            { id: "a", intent: "do another thing", needs: ["ghost"] },
          ],
        },
      ],
    }),
  )

  await mkdir(join(root, "not-json", ".pid"), { recursive: true })
  await writeFile(join(root, "not-json", ".pid", "fleet.json"), "{not json")
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

// The routes take the project root resolution as a function, so a test needs
// no ProjectsService at all — mirrors brainstorms.routes.test.ts. Only ids
// seeded above resolve; anything else is "unknown project".
const SEEDED_IDS = ["empty", "valid", "broken", "not-json"]
const resolveRoot = (id: string) =>
  Promise.resolve(SEEDED_IDS.includes(id) ? join(root, id) : undefined)

// Counts spawn calls by reference rather than a getter spread onto the ports
// object (a getter would freeze to its value-at-spread-time instead of
// staying live) — the dry-run tests assert this stays at 0.
const makePorts = (
  over: Partial<FleetRunPorts> = {},
): { readonly ports: FleetRunPorts; calls: () => number } => {
  let calls = 0
  const ports: FleetRunPorts = {
    now: () => Date.now(),
    newRunId: () => `run-${Math.random().toString(36).slice(2)}`,
    spawn: async () => {
      calls += 1
      return `short-${calls}`
    },
    wait: async () => ({ _tag: "Satisfied", state: "done", waitedMs: 1 }),
    ...over,
  }
  return { ports, calls: () => calls }
}

const waitUntil = async (predicate: () => boolean, timeoutMs = 2000): Promise<void> => {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs)
      throw new Error("waitUntil: timed out waiting for condition")
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

const buildApp = ({
  registry = createFleetRunRegistry(),
  ports = makePorts().ports,
  caps,
}: {
  readonly registry?: FleetRunRegistry
  readonly ports?: FleetRunPorts
  readonly caps?: RunCaps
} = {}) => createApp({ resolveRoot, registry, ports, caps })

const app = buildApp()

describe("fleet routes — GET /:id/fleets", () => {
  it("returns the schema plus wave grouping for a valid recipe", async () => {
    const res = await app.request("/valid/fleets")
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.errors).toEqual([])
    expect(body.fleets).toHaveLength(1)
    expect(body.fleets[0].name).toBe("review-and-fix")
    expect(body.fleets[0].waves).toEqual([["review"], ["fix"]])
    expect(body.fleets[0].steps).toHaveLength(2)
  })

  it("surfaces every validation error at 200, not 500", async () => {
    const res = await app.request("/broken/fleets")
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.fleets).toEqual([])
    expect(body.errors).toContainEqual({
      fleet: "bad",
      step: "a",
      message: 'duplicate step id: "a"',
    })
    expect(body.errors).toContainEqual({
      fleet: "bad",
      step: "a",
      message: 'needs unknown step: "ghost"',
    })
  })

  it("reports malformed JSON as a file-level error, not 500", async () => {
    const res = await app.request("/not-json/fleets")
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      fleets: [],
      errors: [{ fleet: "(file)", step: undefined, message: "fleet.json is not valid JSON" }],
    })
  })

  it("returns empty fleets/errors when there is no fleet.json at all", async () => {
    const res = await app.request("/empty/fleets")
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ fleets: [], errors: [] })
  })

  it("404s for an unknown project", async () => {
    const res = await app.request("/ghost/fleets")
    expect(res.status).toBe(404)
  })
})

describe("fleet routes — POST /:id/fleets/:name/run", () => {
  it("a dry run reports the plan and spawns nothing", async () => {
    const { ports, calls } = makePorts()
    const dryRunApp = buildApp({ ports })
    const res = await dryRunApp.request("/valid/fleets/review-and-fix/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dryRun: true }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.dryRun).toBe(true)
    expect(body.plan.fleet).toBe("review-and-fix")
    expect(body.plan.waves).toEqual([
      [
        {
          id: "review",
          intent: "review the working diff for bugs",
          n: 3,
          agent: undefined,
          cwd: undefined,
          needs: [],
          until: undefined,
          timeoutMs: undefined,
        },
      ],
      [
        {
          id: "fix",
          intent: "fix what the reviewers found",
          n: 1,
          agent: undefined,
          cwd: undefined,
          needs: ["review"],
          until: undefined,
          timeoutMs: undefined,
        },
      ],
    ])
    expect(body.plan.totalSessions).toBe(4)
    expect(calls()).toBe(0)
  })

  it("a real run reports the shorts once every spawn resolves", async () => {
    const registry = createFleetRunRegistry()
    const { ports, calls } = makePorts()
    const realRunApp = buildApp({ registry, ports })
    const res = await realRunApp.request("/valid/fleets/review-and-fix/run", { method: "POST" })
    expect(res.status).toBe(202)
    const body = await res.json()
    expect(typeof body.runId).toBe("string")
    expect(body.totalSessions).toBe(4)
    expect(body.waves).toHaveLength(2)

    await waitUntil(
      () => registry.getRun({ projectId: "valid", runId: body.runId })?.status !== "running",
    )
    expect(calls()).toBe(4)
    const runRes = await realRunApp.request(`/valid/fleet-runs/${body.runId}`)
    const run = await runRes.json()
    expect(run.status).toBe("done")
    expect(run.steps.flatMap((s: { shorts: unknown[] }) => s.shorts)).toHaveLength(4)
  })

  it("refuses a second run of an already-active fleet with 409, naming the active runId", async () => {
    const registry = createFleetRunRegistry()
    const neverResolves: FleetRunPorts["spawn"] = () => new Promise<string>(() => {})
    const { ports } = makePorts({ spawn: neverResolves })
    const gatedApp = buildApp({ registry, ports })
    const first = await gatedApp.request("/valid/fleets/review-and-fix/run", { method: "POST" })
    expect(first.status).toBe(202)
    const firstBody = await first.json()

    const second = await gatedApp.request("/valid/fleets/review-and-fix/run", { method: "POST" })
    expect(second.status).toBe(409)
    expect(await second.json()).toEqual({ error: "already_active", runId: firstBody.runId })
  })

  it("rejects a plan that exceeds the total-sessions cap with 400", async () => {
    const cappedApp = buildApp({ caps: { maxTotalSessions: 2, maxConcurrentSpawns: 5 } })
    const res = await cappedApp.request("/valid/fleets/review-and-fix/run", { method: "POST" })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe("cap_exceeded")
    expect(body.violation).toEqual({ _tag: "TotalSessionsExceeded", requested: 4, max: 2 })
  })

  it("404s for an unknown fleet name in an otherwise valid project", async () => {
    const res = await app.request("/valid/fleets/ghost-fleet/run", { method: "POST" })
    expect(res.status).toBe(404)
  })

  it("404s for an unknown project", async () => {
    const res = await app.request("/ghost/fleets/review-and-fix/run", { method: "POST" })
    expect(res.status).toBe(404)
  })

  it("400s an invalid recipe rather than trying to run it", async () => {
    const res = await app.request("/broken/fleets/bad/run", { method: "POST" })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe("invalid_recipe")
  })

  it("400s a non-boolean dryRun", async () => {
    const res = await app.request("/valid/fleets/review-and-fix/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dryRun: "yes" }),
    })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe("invalid_body")
  })
})

describe("fleet routes — GET /:id/fleet-runs[/:runId]", () => {
  it("lists every run started for a project and fetches one by id", async () => {
    const registry = createFleetRunRegistry()
    const { ports } = makePorts()
    const runsApp = buildApp({ registry, ports })
    const started = await runsApp.request("/valid/fleets/review-and-fix/run", { method: "POST" })
    const { runId } = await started.json()

    const listRes = await runsApp.request("/valid/fleet-runs")
    expect(listRes.status).toBe(200)
    const list = await listRes.json()
    expect(list.runs.map((r: { id: string }) => r.id)).toEqual([runId])

    const oneRes = await runsApp.request(`/valid/fleet-runs/${runId}`)
    expect(oneRes.status).toBe(200)
    expect((await oneRes.json()).id).toBe(runId)
  })

  it("404s a run id that does not exist", async () => {
    const res = await app.request("/valid/fleet-runs/ghost-run")
    expect(res.status).toBe(404)
  })

  it("404s fleet-runs for an unknown project", async () => {
    expect((await app.request("/ghost/fleet-runs")).status).toBe(404)
    expect((await app.request("/ghost/fleet-runs/ghost-run")).status).toBe(404)
  })
})
