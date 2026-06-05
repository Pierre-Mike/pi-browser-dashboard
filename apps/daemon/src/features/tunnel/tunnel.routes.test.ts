import { describe, expect, it } from "bun:test"
import { Effect, Layer, ManagedRuntime } from "effect"
import type { TunnelState } from "./tunnel.core"
import { TunnelService, type TunnelServiceApi } from "./tunnel.repo"
import { buildTunnelApp } from "./tunnel.routes"

const buildHarness = (initial: TunnelState) => {
  const calls: string[] = []
  let current = initial
  const api: TunnelServiceApi = {
    getState: () => Effect.sync(() => current),
    start: () =>
      Effect.sync(() => {
        calls.push("start")
        current = { status: "running", url: "https://stub.trycloudflare.com" }
        return current
      }),
    stop: () =>
      Effect.sync(() => {
        calls.push("stop")
        current = { status: "stopped", url: null }
        return current
      }),
  }
  const runtime = ManagedRuntime.make(Layer.succeed(TunnelService, api))
  return { app: buildTunnelApp(runtime), calls }
}

describe("tunnel.routes", () => {
  it("GET /status returns the current state", async () => {
    const { app } = buildHarness({ status: "running", url: "https://x.trycloudflare.com" })
    const res = await app.request("/status")
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: "running", url: "https://x.trycloudflare.com" })
  })

  it("POST /start starts the tunnel and returns the running state", async () => {
    const { app, calls } = buildHarness({ status: "stopped", url: null })
    const res = await app.request("/start", { method: "POST" })
    expect(res.status).toBe(200)
    expect(calls).toEqual(["start"])
    expect(await res.json()).toEqual({ status: "running", url: "https://stub.trycloudflare.com" })
  })

  it("POST /stop stops the tunnel", async () => {
    const { app, calls } = buildHarness({ status: "running", url: "https://x.trycloudflare.com" })
    const res = await app.request("/stop", { method: "POST" })
    expect(res.status).toBe(200)
    expect(calls).toEqual(["stop"])
    expect(await res.json()).toEqual({ status: "stopped", url: null })
  })
})
