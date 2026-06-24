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

  it("desktop: from a views:// webview, VITE_API_URL hits the embedded daemon directly (no /__api proxy)", () => {
    const base = computeApiBase("http://localhost:8787", "views://mainview")
    expect(base).toBe("http://localhost:8787")
    expect(base).not.toContain(API_PREFIX)
  })
})

describe("computeWsBase", () => {
  // WebSockets route through the same-origin /__api proxy, exactly like REST.
  // Running Vite under Node (not Bun) lets http-proxy relay the WS upgrade, so
  // terminals/canvas work over the Cloudflare tunnel — the tunnel only exposes
  // the Vite origin, never the daemon's :8787.
  it("routes through the same origin under /__api when in a browser (tunnel)", () => {
    expect(computeWsBase(undefined, "https://abc.trycloudflare.com")).toBe(
      `https://abc.trycloudflare.com${API_PREFIX}`,
    )
  })

  it("uses the same-origin /__api prefix for plain localhost dev too", () => {
    expect(computeWsBase(undefined, "http://localhost:5173")).toBe(
      `http://localhost:5173${API_PREFIX}`,
    )
  })

  it("falls back to the local daemon when there is no window", () => {
    const base = computeWsBase(undefined, null)
    expect(base).toBe("http://localhost:8787")
    expect(base).not.toContain(API_PREFIX)
  })

  it("honours VITE_API_URL verbatim when set (e2e / explicit daemon)", () => {
    expect(computeWsBase("http://localhost:18787", "https://abc.trycloudflare.com")).toBe(
      "http://localhost:18787",
    )
  })
})
