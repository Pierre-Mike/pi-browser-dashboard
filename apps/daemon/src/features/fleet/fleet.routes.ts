import { Either } from "effect"
import { Hono } from "hono"
import { type Fleet, planFleetRun } from "./fleet.core"
import { readFleetFile } from "./fleet.io"
import {
  DEFAULT_RUN_CAPS,
  parseRunRequestBody,
  planRun,
  type RunCaps,
  type RunPlan,
  type StepPlan,
} from "./fleet-run.core"
import type { FleetRunPorts, FleetRunRegistry } from "./fleet-run.io"

// How a request's project id becomes the directory tree its `.pid/fleet.json`
// lives in: `undefined` for an unknown project id. Injected rather than
// imported so this slice never depends on the projects slice — mirrors
// sessions.routes.ts's `resolveSessionRoot` / brainstorms.routes.ts's
// `RootResolver`. `api.ts` wires this to `projectsRoute.resolveProjectRoot`;
// a test can point it at a tmp dir directly.
export type ProjectRootResolver = (id: string) => Promise<string | undefined>

// The wire shape for one fleet: its schema plus the wave grouping the (not
// yet built) runner would execute — computed here, not stored, since it is a
// pure function of the already-validated steps.
const withWaves = (fleet: Fleet) => {
  const planned = planFleetRun({ fleet })
  // Cannot fail in practice: parseFleetFile already rejects any fleet with a
  // dependency cycle before it ever reaches this list. Falls back to an empty
  // plan rather than throwing if that invariant is ever violated.
  return { ...fleet, waves: Either.isRight(planned) ? planned.right : [] }
}

// A StepPlan on the wire, keyed `id` rather than `stepId` so it matches the
// GET /:id/fleets step shape byte-for-byte — same fields, same names — which
// lets the CLI reuse a single step parser for both endpoints.
const toWireStep = (step: StepPlan) => ({
  id: step.stepId,
  intent: step.intent,
  n: step.n,
  agent: step.agent,
  cwd: step.cwd,
  needs: step.needs,
  until: step.until,
  timeoutMs: step.timeoutMs,
})

const toWireWaves = (waves: RunPlan["waves"]) => waves.map((wave) => wave.map(toWireStep))

const toWirePlan = (plan: RunPlan) => ({
  fleet: plan.fleet,
  waves: toWireWaves(plan.waves),
  totalSessions: plan.totalSessions,
  maxConcurrentSpawns: plan.maxConcurrentSpawns,
})

export type FleetRouteDeps = {
  readonly resolveRoot: ProjectRootResolver
  readonly registry: FleetRunRegistry
  readonly ports: FleetRunPorts
  readonly caps?: RunCaps
}

// Mounted under the projects router (leaf-relative, reads the parent `:id`
// param): GET /projects/:id/fleets, POST /projects/:id/fleets/:name/run,
// GET /projects/:id/fleet-runs[/:runId].
export const createApp = ({
  resolveRoot,
  registry,
  ports,
  caps = DEFAULT_RUN_CAPS,
}: FleetRouteDeps) =>
  new Hono()
    .get("/:id/fleets", async (c) => {
      const root = await resolveRoot(c.req.param("id"))
      if (root === undefined) return c.json({ error: "not_found" }, 404)
      // A malformed recipe is a 200 with its errors listed, not a 500 — the
      // caller's job (the `pid fleets` CLI, or a future dashboard tab) is to
      // show the author what to fix, not to treat their own file as a server
      // failure. Only an unresolvable project id is an HTTP error.
      const result = await readFleetFile(root)
      return c.json({ fleets: result.fleets.map(withWaves), errors: result.errors })
    })
    .post("/:id/fleets/:name/run", async (c) => {
      const root = await resolveRoot(c.req.param("id"))
      if (root === undefined) return c.json({ error: "not_found" }, 404)
      let rawBody: unknown
      try {
        rawBody = await c.req.json()
      } catch {
        rawBody = undefined
      }
      const parsedBody = parseRunRequestBody(rawBody)
      if (Either.isLeft(parsedBody)) {
        return c.json({ error: "invalid_body", message: parsedBody.left }, 400)
      }
      const { fleets, errors } = await readFleetFile(root)
      if (errors.length > 0) return c.json({ error: "invalid_recipe", errors }, 400)
      const fleet = fleets.find((f) => f.name === c.req.param("name"))
      if (fleet === undefined) return c.json({ error: "not_found" }, 404)
      const planned = planRun({ fleet, caps })
      if (Either.isLeft(planned))
        return c.json({ error: "cap_exceeded", violation: planned.left }, 400)
      if (parsedBody.right.dryRun) {
        return c.json({ dryRun: true, plan: toWirePlan(planned.right) })
      }
      const started = registry.startRun({
        projectId: c.req.param("id"),
        projectRoot: root,
        plan: planned.right,
        ports,
      })
      if (started._tag === "AlreadyActive") {
        return c.json({ error: "already_active", runId: started.runId }, 409)
      }
      return c.json(
        {
          runId: started.runId,
          waves: toWireWaves(planned.right.waves),
          totalSessions: planned.right.totalSessions,
        },
        202,
      )
    })
    .get("/:id/fleet-runs", async (c) => {
      const root = await resolveRoot(c.req.param("id"))
      if (root === undefined) return c.json({ error: "not_found" }, 404)
      return c.json({ runs: registry.listRuns({ projectId: c.req.param("id") }) })
    })
    .get("/:id/fleet-runs/:runId", async (c) => {
      const root = await resolveRoot(c.req.param("id"))
      if (root === undefined) return c.json({ error: "not_found" }, 404)
      const run = registry.getRun({ projectId: c.req.param("id"), runId: c.req.param("runId") })
      if (run === undefined) return c.json({ error: "not_found" }, 404)
      return c.json(run)
    })
