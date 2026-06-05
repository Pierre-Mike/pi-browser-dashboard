import { Effect, type ManagedRuntime } from "effect"
import { Hono } from "hono"
import { appRuntime } from "../../platform/runtime"
import { TunnelService } from "./tunnel.repo"

// Effect runtime surface the route handlers depend on. Real prod wiring passes
// `appRuntime`; route tests substitute a stub runtime built over a fake
// TunnelService layer (see tunnel.routes.test.ts).
export type TunnelRouteRuntime = Pick<
  ManagedRuntime.ManagedRuntime<TunnelService, never>,
  "runPromise"
>

export const buildTunnelApp = (runtime: TunnelRouteRuntime) =>
  new Hono()
    .get("/status", async (c) => {
      const state = await runtime.runPromise(Effect.flatMap(TunnelService, (s) => s.getState()))
      return c.json(state)
    })
    .post("/start", async (c) => {
      const state = await runtime.runPromise(Effect.flatMap(TunnelService, (s) => s.start()))
      return c.json(state)
    })
    .post("/stop", async (c) => {
      const state = await runtime.runPromise(Effect.flatMap(TunnelService, (s) => s.stop()))
      return c.json(state)
    })

const app = buildTunnelApp(appRuntime)

export { app }
