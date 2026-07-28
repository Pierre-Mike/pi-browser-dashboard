import { Cause, Effect, type ManagedRuntime, Option } from "effect"
import { Hono } from "hono"
import { appRuntime } from "../../platform/runtime"
import { type ShellError, ShellIo } from "../../platform/shell.io"
import { type DispatchBody, type ParsedDispatch, parseDispatchRequest } from "./dispatch.core"
import { PiIo } from "./pi.io"

export type DispatchRouteRuntime = Pick<
  ManagedRuntime.ManagedRuntime<ShellIo | PiIo, never>,
  "runPromiseExit"
>

// Route the parsed request to its harness's repo. Both return the session
// handle the caller polls/attaches with — claude's supervisor short id, or
// the pi session uuid the daemon minted.
const dispatchEffect = (
  parsed: Extract<ParsedDispatch, { ok: true }>,
): Effect.Effect<string, ShellError, ShellIo | PiIo> =>
  Effect.gen(function* () {
    if (parsed.harness === "pi") {
      const pi = yield* PiIo
      return yield* pi.dispatch(parsed.pi)
    }
    const shell = yield* ShellIo
    return yield* shell.dispatch(parsed.claude)
  })

export const buildDispatchApp = (runtime: DispatchRouteRuntime) =>
  new Hono()
    .post("/", async (c) => {
      let body: DispatchBody
      try {
        body = (await c.req.json()) as DispatchBody
      } catch {
        return c.json({ error: "invalid_json" }, 400)
      }
      const parsed = parseDispatchRequest(body)
      if (!parsed.ok) {
        return c.json({ error: parsed.error }, 400)
      }
      const exit = await runtime.runPromiseExit(dispatchEffect(parsed))
      if (exit._tag === "Failure") {
        // Forward the harness's own words (e.g. pi's "No API key for
        // provider: …") so the modal can show why the spawn never started.
        const detail = Option.map(Cause.failureOption(exit.cause), (e) => e.message)
        return c.json({ error: "dispatch_failed", detail: Option.getOrUndefined(detail) }, 500)
      }
      return c.json({ short: exit.value })
    })
    .get("/pi-models", async (c) => {
      const exit = await runtime.runPromiseExit(
        Effect.gen(function* () {
          const pi = yield* PiIo
          return yield* pi.listModels()
        }),
      )
      if (exit._tag === "Failure") {
        return c.json({ error: "pi_models_failed" }, 500)
      }
      return c.json({ models: exit.value })
    })

const app = buildDispatchApp(appRuntime)

export { app }
