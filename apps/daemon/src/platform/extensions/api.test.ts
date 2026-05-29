import { describe, expect, it } from "bun:test"
import { Hono } from "hono"
import { sseBus } from "../sse-bus"
import { createExtensionApi } from "./api"
import type { ExtensionManifest } from "./manifest"
import { createRegistry } from "./registry"

const manifest: ExtensionManifest = {
  name: "demo",
  version: "1.0.0",
  tier: "esm",
  daemonEntry: "daemon.ts",
}

describe("createExtensionApi", () => {
  it("registerRoute mounts the app under /ext/<name><basePath>", () => {
    const registry = createRegistry()
    const api = createExtensionApi({ manifest, dir: "/x", registry, granted: {} })
    const sub = new Hono().get("/ping", (c) => c.text("pong"))
    api.registerRoute("/api", sub)
    const entry = registry.get("demo")
    expect(entry).toBeDefined()
    // route mounted under combined base path
    const mounts = registry.mounts()
    expect(mounts.some((m) => m.basePath === "/ext/demo")).toBe(true)
  })

  it("emit publishes an ext-namespaced event on the sseBus", () => {
    const registry = createRegistry()
    const api = createExtensionApi({ manifest, dir: "/x", registry, granted: {} })
    const seen: { type: string; data: unknown }[] = []
    const unsub = sseBus.subscribe((e) => seen.push(e))
    api.emit("hello", { n: 1 })
    unsub()
    expect(seen).toContainEqual({ type: "ext:demo:hello", data: { n: 1 } })
  })

  it("on subscribes to sseBus events by type", () => {
    const registry = createRegistry()
    const api = createExtensionApi({ manifest, dir: "/x", registry, granted: {} })
    const got: unknown[] = []
    api.on("some.event", (data) => got.push(data))
    sseBus.publish({ type: "some.event", data: 42 })
    sseBus.publish({ type: "other.event", data: 99 })
    expect(got).toEqual([42])
  })

  it("registerWatcher collects watchers", () => {
    const registry = createRegistry()
    const api = createExtensionApi({ manifest, dir: "/x", registry, granted: {} })
    let count = 0
    api.registerWatcher(() => {
      count++
    })
    expect(api.watchers.length).toBe(1)
    expect(count).toBe(0)
  })
})
