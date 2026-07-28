import { Either } from "effect"
import { Hono } from "hono"
import { type Fleet, planFleetRun } from "./fleet.core"
import { readFleetFile } from "./fleet.io"

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

// Mounted under the projects router (leaf-relative, reads the parent `:id`
// param): GET /projects/:id/fleets.
export const createApp = (resolveRoot: ProjectRootResolver) =>
  new Hono().get("/:id/fleets", async (c) => {
    const root = await resolveRoot(c.req.param("id"))
    if (root === undefined) return c.json({ error: "not_found" }, 404)
    // A malformed recipe is a 200 with its errors listed, not a 500 — the
    // caller's job (the `pid fleets` CLI, or a future dashboard tab) is to
    // show the author what to fix, not to treat their own file as a server
    // failure. Only an unresolvable project id is an HTTP error.
    const result = await readFleetFile(root)
    return c.json({ fleets: result.fleets.map(withWaves), errors: result.errors })
  })
