import { describe, expect, it } from "bun:test"
import { parseTunnelUrl, STOPPED, tunnelHost } from "./tunnel.core"

describe("parseTunnelUrl", () => {
  it("extracts the trycloudflare URL from a cloudflared stderr banner", () => {
    const banner = [
      "2024-01-01T00:00:00Z INF Requesting new quick Tunnel on trycloudflare.com...",
      "2024-01-01T00:00:00Z INF +--------------------------------------------------------+",
      "2024-01-01T00:00:00Z INF |  https://brave-cat-runs-fast.trycloudflare.com         |",
      "2024-01-01T00:00:00Z INF +--------------------------------------------------------+",
    ].join("\n")
    expect(parseTunnelUrl(banner)).toBe("https://brave-cat-runs-fast.trycloudflare.com")
  })

  it("returns the first URL when several are present", () => {
    const s = "https://aaa.trycloudflare.com then https://bbb.trycloudflare.com"
    expect(parseTunnelUrl(s)).toBe("https://aaa.trycloudflare.com")
  })

  it("returns null before any URL is logged", () => {
    expect(parseTunnelUrl("INF Requesting new quick Tunnel on trycloudflare.com...")).toBeNull()
  })

  it("ignores non-trycloudflare https URLs", () => {
    expect(parseTunnelUrl("see https://example.com for details")).toBeNull()
  })
})

describe("tunnelHost", () => {
  it("returns the lowercased host", () => {
    expect(tunnelHost("https://Brave-Cat.trycloudflare.com")).toBe("brave-cat.trycloudflare.com")
  })

  it("returns null for a non-URL", () => {
    expect(tunnelHost("not a url")).toBeNull()
  })
})

describe("STOPPED", () => {
  it("is the stopped sentinel", () => {
    expect(STOPPED).toEqual({ status: "stopped", url: null })
  })
})
