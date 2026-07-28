import { afterEach, describe, expect, it } from "bun:test"
import app from "./api"

// Verifies api.ts wires the per-request CORS origin callback (cors.core.ts) to
// process.env — the plumbing that lets a caller widen the allow-list after this
// module is already imported (the e2e harness, a tunnel host).
const ORIGINAL = process.env.PID_CORS_ORIGINS

afterEach(() => {
  if (ORIGINAL === undefined) process.env.PID_CORS_ORIGINS = undefined
  else process.env.PID_CORS_ORIGINS = ORIGINAL
})

describe("api CORS", () => {
  it("echoes the dev origin", async () => {
    const res = await app.request("/health", { headers: { Origin: "http://localhost:5173" } })
    expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:5173")
  })

  it("rejects an unknown origin (no allow-origin header)", async () => {
    process.env.PID_CORS_ORIGINS = undefined
    const res = await app.request("/health", { headers: { Origin: "https://evil.test" } })
    expect(res.headers.get("access-control-allow-origin")).toBeNull()
  })

  it("reads PID_CORS_ORIGINS per request, after the module was already imported", async () => {
    process.env.PID_CORS_ORIGINS = "https://tunnel.test"
    const res = await app.request("/health", { headers: { Origin: "https://tunnel.test" } })
    expect(res.headers.get("access-control-allow-origin")).toBe("https://tunnel.test")
  })
})
