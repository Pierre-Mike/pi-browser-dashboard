import { describe, expect, it } from "bun:test"
import { API_PREFIX, computeApiBase, computeWsBase } from "./apiBase"

describe("computeApiBase", () => {
  it("returns VITE_API_URL verbatim when set (direct daemon, no prefix)", () => {
    expect(computeApiBase("http://localhost:18787", "https://x.trycloudflare.com")).toBe(
      "http://localhost:18787",
    )
  })

  it("routes through the same origin under /__api when in a browser", () => {
    expect(computeApiBase(undefined, "https://abc.trycloudflare.com")).toBe(
      `https://abc.trycloudflare.com${API_PREFIX}`,
    )
  })

  it("uses the same-origin prefix for plain localhost dev too", () => {
    expect(computeApiBase(undefined, "http://localhost:5173")).toBe(
      `http://localhost:5173${API_PREFIX}`,
    )
  })

  it("falls back to the local daemon when there is no window", () => {
    expect(computeApiBase(undefined, null)).toBe("http://localhost:8787")
  })
})

describe("computeWsBase", () => {
  // WebSockets bypass the /__api same-origin proxy (node-http-proxy can't
  // upgrade against the Bun daemon) and hit the daemon directly.
  it("connects straight to the local daemon, NOT a same-origin /__api prefix", () => {
    const base = computeWsBase(undefined)
    expect(base).toBe("http://localhost:8787")
    expect(base).not.toContain(API_PREFIX)
  })

  it("honours VITE_API_URL verbatim when set (e2e / explicit daemon)", () => {
    expect(computeWsBase("http://localhost:18787")).toBe("http://localhost:18787")
  })
})
