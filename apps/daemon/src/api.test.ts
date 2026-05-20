import { describe, expect, it } from "bun:test"
import { app } from "./api"

describe("GET /health", () => {
  it("returns 200 with body { ok: true }", async () => {
    const res = await app.request("/health")
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })
})
