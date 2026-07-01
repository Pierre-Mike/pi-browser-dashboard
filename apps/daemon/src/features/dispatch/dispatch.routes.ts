import { Effect, type ManagedRuntime } from "effect"
import { Hono } from "hono"
import { appRuntime } from "../../platform/runtime"
import { ShellRepo } from "../../platform/shell.repo"

type DispatchBody = {
  readonly intent?: unknown
  readonly cwd?: unknown
  readonly agent?: unknown
  readonly permissionMode?: unknown
  readonly effort?: unknown
  readonly tools?: unknown
}

const asString = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined)

// A malformed entry (wrong type, mixed array) is treated as absent rather than
// partially sanitized, so a bad request can't silently narrow the tool set to
// something the user never selected.
const asStringArray = (v: unknown): string[] | undefined =>
  Array.isArray(v) && v.every((entry) => typeof entry === "string") ? v : undefined

export type DispatchRouteRuntime = Pick<
  ManagedRuntime.ManagedRuntime<ShellRepo, never>,
  "runPromiseExit"
>

export const buildDispatchApp = (runtime: DispatchRouteRuntime) =>
  new Hono().post("/", async (c) => {
    let body: DispatchBody
    try {
      body = (await c.req.json()) as DispatchBody
    } catch {
      return c.json({ error: "invalid_json" }, 400)
    }
    const intent = asString(body.intent)
    if (!intent || intent.trim().length === 0) {
      return c.json({ error: "missing_intent" }, 400)
    }
    const cwd = asString(body.cwd)
    const agent = asString(body.agent)
    const permissionMode = asString(body.permissionMode)
    const effort = asString(body.effort)
    const tools = asStringArray(body.tools)

    const exit = await runtime.runPromiseExit(
      Effect.gen(function* () {
        const shell = yield* ShellRepo
        return yield* shell.dispatch({ intent, cwd, agent, permissionMode, effort, tools })
      }),
    )

    if (exit._tag === "Failure") {
      return c.json({ error: "dispatch_failed" }, 500)
    }
    return c.json({ short: exit.value })
  })

const app = buildDispatchApp(appRuntime)

export { app }
