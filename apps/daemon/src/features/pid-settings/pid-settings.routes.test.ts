import { describe, expect, it } from "bun:test"
import { ManagedRuntime } from "effect"
import { PidSettingsRepoTest } from "./pid-settings.repo"
import { createApp } from "./pid-settings.routes"

const buildApp = () => {
  const rt = ManagedRuntime.make(PidSettingsRepoTest({ preset: { defaultSkills: ["align"] } }))
  return createApp((effect) => rt.runPromise(effect))
}

describe("pid-settings routes", () => {
  it("GET /:id/pid-settings returns defaults for an unknown-but-safe project", async () => {
    const res = await buildApp().request("/demo/pid-settings")
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ defaultSkills: ["goal"] })
  })

  it("GET /:id/pid-settings returns stored settings", async () => {
    const res = await buildApp().request("/preset/pid-settings")
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ defaultSkills: ["align"] })
  })

  it("GET /:id/pid-settings 403s for unsafe ids", async () => {
    const res = await buildApp().request("/.secret/pid-settings")
    expect(res.status).toBe(403)
  })

  it("POST /:id/pid-settings persists and returns the merged settings", async () => {
    const app = buildApp()
    const res = await app.request("/demo/pid-settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ defaultSkills: ["tdd", "concise"] }),
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ defaultSkills: ["tdd", "concise"] })

    const reread = await app.request("/demo/pid-settings")
    expect(await reread.json()).toEqual({ defaultSkills: ["tdd", "concise"] })
  })

  it("POST /:id/pid-settings 400s on a non-JSON body", async () => {
    const res = await buildApp().request("/demo/pid-settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not json",
    })
    expect(res.status).toBe(400)
  })
})
