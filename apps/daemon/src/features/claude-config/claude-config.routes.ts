import { Effect } from "effect"
import { Hono } from "hono"
import { appRuntime } from "../../platform/runtime"
import { type ClaudeConfigError, ClaudeConfigService } from "./claude-config.repo"

const errorToStatus = (e: ClaudeConfigError): 403 | 404 => (e === "forbidden" ? 403 : 404)

const app = new Hono()
  .get("/global", async (c) => {
    const bundle = await appRuntime.runPromise(
      Effect.flatMap(ClaudeConfigService, (s) => s.readGlobal()),
    )
    return c.json(bundle)
  })
  .get("/global/skills/:skillId", async (c) => {
    const skillId = c.req.param("skillId")
    const result = await appRuntime.runPromise(
      Effect.flatMap(ClaudeConfigService, (s) => s.readSkill("global", null, skillId)).pipe(
        Effect.either,
      ),
    )
    if (result._tag === "Left") return c.json({ error: result.left }, errorToStatus(result.left))
    return c.json(result.right)
  })
  .get("/projects/:id", async (c) => {
    const id = c.req.param("id")
    const result = await appRuntime.runPromise(
      Effect.flatMap(ClaudeConfigService, (s) => s.readProject(id)).pipe(Effect.either),
    )
    if (result._tag === "Left") return c.json({ error: result.left }, errorToStatus(result.left))
    return c.json(result.right)
  })
  .get("/projects/:id/skills/:skillId", async (c) => {
    const id = c.req.param("id")
    const skillId = c.req.param("skillId")
    const result = await appRuntime.runPromise(
      Effect.flatMap(ClaudeConfigService, (s) => s.readSkill("project", id, skillId)).pipe(
        Effect.either,
      ),
    )
    if (result._tag === "Left") return c.json({ error: result.left }, errorToStatus(result.left))
    return c.json(result.right)
  })

export { app }
