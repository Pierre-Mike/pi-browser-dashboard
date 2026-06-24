import { afterEach, describe, expect, it } from "bun:test"
import app from "./api"

// Verifies api.ts wires the per-request CORS origin callback (cors.core.ts) to
// process.env — the plumbing the embedded desktop daemon relies on.
const ORIGINAL = process.env.PID_ALLOW_VIEWS_ORIGIN

afterEach(() => {
  if (ORIGINAL === undefined) process.env.PID_ALLOW_VIEWS_ORIGIN = undefined
  else process.env.PID_ALLOW_VIEWS_ORIGIN = ORIGINAL
})

describe("api CORS", () => {
  it("echoes the dev origin", async () => {
    const res = await app.request("/health", { headers: { Origin: "http://localhost:5173" } })
    expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:5173")
  })

  it("rejects an unknown origin (no allow-origin header)", async () => {
    process.env.PID_ALLOW_VIEWS_ORIGIN = undefined
    const res = await app.request("/health", { headers: { Origin: "views://mainview" } })
    expect(res.headers.get("access-control-allow-origin")).toBeNull()
  })

  it("allows a views:// origin when PID_ALLOW_VIEWS_ORIGIN=1", async () => {
    process.env.PID_ALLOW_VIEWS_ORIGIN = "1"
    const res = await app.request("/health", { headers: { Origin: "views://mainview" } })
    expect(res.headers.get("access-control-allow-origin")).toBe("views://mainview")
  })
})
