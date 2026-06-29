import { describe, expect, it } from "bun:test"
import { ManagedRuntime } from "effect"
import { DEFAULT_GLOBAL_SETTINGS } from "./global-settings.core"
import { GlobalSettingsRepoTest } from "./global-settings.repo"
import { createApp } from "./global-settings.routes"

const buildApp = () => {
  const rt = ManagedRuntime.make(GlobalSettingsRepoTest())
  return createApp((effect) => rt.runPromise(effect))
}

describe("global-settings routes", () => {
  it("GET /settings returns defaults", async () => {
    const res = await buildApp().request("/settings")
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(DEFAULT_GLOBAL_SETTINGS)
  })

  it("POST /settings persists a patch and returns merged settings", async () => {
    const app = buildApp()
    const res = await app.request("/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ git: { defaultBranch: "trunk" }, orchestration: { maxParallel: 4 } }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.git.defaultBranch).toBe("trunk")
    expect(body.orchestration.maxParallel).toBe(4)

    const reread = await (await app.request("/settings")).json()
    expect(reread.git.defaultBranch).toBe("trunk")
  })

  it("POST /settings 400s on a non-JSON body", async () => {
    const res = await buildApp().request("/settings", { method: "POST", body: "{not json" })
    expect(res.status).toBe(400)
  })

  it("POST /settings 400s on a non-object body", async () => {
    const res = await buildApp().request("/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "[1,2,3]",
    })
    expect(res.status).toBe(400)
  })

  it("POST /settings persists a skillGroups list (replacing the whole set)", async () => {
    const app = buildApp()
    const res = await app.request("/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        skillGroups: [{ name: "TDD flow", skills: ["tdd", "ts-axioms", "pr-automerge"] }],
      }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.skillGroups).toEqual([
      { name: "TDD flow", skills: ["tdd", "ts-axioms", "pr-automerge"] },
    ])

    const reread = await (await app.request("/settings")).json()
    expect(reread.skillGroups).toEqual([
      { name: "TDD flow", skills: ["tdd", "ts-axioms", "pr-automerge"] },
    ])
  })

  it("POST /settings ignores a non-array skillGroups", async () => {
    const app = buildApp()
    const res = await app.request("/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ skillGroups: "nope" }),
    })
    expect(res.status).toBe(200)
    expect((await res.json()).skillGroups).toEqual([])
  })

  it("POST /settings ignores unknown keys and bad values without corrupting state", async () => {
    const app = buildApp()
    const res = await app.request("/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bogus: true, network: { appPort: -1 } }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.network.appPort).toBe(DEFAULT_GLOBAL_SETTINGS.network.appPort)
  })
})
