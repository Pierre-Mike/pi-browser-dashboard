import { Effect } from "effect"
import { Hono, type Context as HonoContext } from "hono"
import { appRuntime } from "../../platform/runtime"
import type { GlobalSettings, GlobalSettingsPatch } from "./global-settings.core"
import { GlobalSettingsService } from "./global-settings.repo"

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)

// Keep only the known top-level sections; mergeGlobalSettings validates the
// nested field values, so a bad value is dropped rather than rejecting the
// whole request.
const SECTIONS = ["git", "library", "orchestration", "network"] as const

const toPatch = (body: Record<string, unknown>): GlobalSettingsPatch => {
  const patch: Record<string, unknown> = {}
  for (const k of SECTIONS) {
    if (isObject(body[k])) patch[k] = body[k]
  }
  return patch as GlobalSettingsPatch
}

// Minimal slice of a ManagedRuntime: just what these routes call. Letting the
// app take this lets the test build it over a test-layer runtime and exercise
// the real handlers.
type RunPromise = <A>(effect: Effect.Effect<A, never, GlobalSettingsService>) => Promise<A>

export const createApp = (run: RunPromise) => {
  const respond = (
    c: HonoContext,
    call: (s: typeof GlobalSettingsService.Service) => Effect.Effect<GlobalSettings>,
  ) => run(Effect.flatMap(GlobalSettingsService, call)).then((v) => c.json(v))

  return (
    new Hono()
      .get("/settings", (c) => respond(c, (s) => s.read()))
      // POST (not PUT): the CORS layer only allows GET/POST/OPTIONS cross-origin.
      .post("/settings", async (c) => {
        let body: unknown
        try {
          body = await c.req.json()
        } catch {
          return c.json({ error: "invalid_body" }, 400)
        }
        if (!isObject(body)) return c.json({ error: "invalid_body" }, 400)
        return respond(c, (s) => s.update(toPatch(body)))
      })
  )
}

const app = createApp((effect) => appRuntime.runPromise(effect))

export { app }
