import { describe, expect, it } from "bun:test"
import { parseTunnelState } from "./tunnel.parse"

describe("parseTunnelState", () => {
  it("accepts a running tunnel with a url", () => {
    expect(parseTunnelState({ status: "running", url: "https://x.trycloudflare.com" })).toEqual({
      status: "running",
      url: "https://x.trycloudflare.com",
    })
  })

  it("accepts a stopped tunnel with a null url", () => {
    expect(parseTunnelState({ status: "stopped", url: null })).toEqual({
      status: "stopped",
      url: null,
    })
  })

  it("accepts an error status carrying an error message", () => {
    expect(parseTunnelState({ status: "error", url: null, error: "cloudflared exited" })).toEqual({
      status: "error",
      url: null,
      error: "cloudflared exited",
    })
  })

  it("rejects an unrecognized status", () => {
    expect(parseTunnelState({ status: "paused", url: null })).toBeNull()
  })

  it("rejects a non-null, non-string url", () => {
    expect(parseTunnelState({ status: "running", url: 1 })).toBeNull()
  })

  it("rejects a non-object", () => {
    expect(parseTunnelState(null)).toBeNull()
  })
})
