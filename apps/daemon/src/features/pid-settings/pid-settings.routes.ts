import { Effect } from "effect"
import { Hono, type Context as HonoContext } from "hono"
import { appRuntime } from "../../platform/runtime"
import type { PidSettings, PidSettingsPatch } from "./pid-settings.core"
import { type PidSettingsError, PidSettingsService } from "./pid-settings.repo"

const errorToStatus = (e: PidSettingsError): 403 | 404 => (e === "forbidden" ? 403 : 404)

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)

// Extract the known patch fields, ignoring anything else. Type validation of
// individual values happens in mergePidSettings, so a bad value is dropped
// rather than rejecting the whole request.
const toPatch = (body: unknown): PidSettingsPatch =>
  isObject(body) && body.defaultSkills !== undefined
    ? { defaultSkills: body.defaultSkills as PidSettingsPatch["defaultSkills"] }
    : {}

// Minimal slice of a ManagedRuntime: just what these routes call. Letting the
// app take this lets the test build it over a test-layer runtime and exercise
// the real handlers, rather than re-implementing them.
type RunPromise = <A>(effect: Effect.Effect<A, never, PidSettingsService>) => Promise<A>

type ServiceCall = (
  s: typeof PidSettingsService.Service,
) => Effect.Effect<PidSettings, PidSettingsError>

// Mounted under the projects router, so the routes are leaf-relative and read
// the project id from the parent `:id` param: GET/POST /projects/:id/pid-settings.
export const createApp = (run: RunPromise) => {
  // Run a service call and render its Either result as JSON: the success value
  // on the right, or `{ error }` with the mapped status on the left.
  const respond = async (c: HonoContext, call: ServiceCall) => {
    const r = await run(Effect.flatMap(PidSettingsService, call).pipe(Effect.either))
    return r._tag === "Left" ? c.json({ error: r.left }, errorToStatus(r.left)) : c.json(r.right)
  }

  return (
    new Hono()
      .get("/:id/pid-settings", (c) => respond(c, (s) => s.readProject(c.req.param("id"))))
      // POST (not PUT): the CORS layer only allows GET/POST/OPTIONS cross-origin.
      .post("/:id/pid-settings", async (c) => {
        let body: unknown
        try {
          body = await c.req.json()
        } catch {
          return c.json({ error: "invalid_body" }, 400)
        }
        if (!isObject(body)) return c.json({ error: "invalid_body" }, 400)
        return respond(c, (s) => s.updateProject(c.req.param("id"), toPatch(body)))
      })
  )
}

const app = createApp((effect) => appRuntime.runPromise(effect))

export { app }
