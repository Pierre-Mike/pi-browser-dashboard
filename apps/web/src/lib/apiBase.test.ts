import { describe, expect, it } from "bun:test"
import { API_PREFIX, computeApiBase } from "./apiBase"

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
