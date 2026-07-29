import { describe, expect, it } from "bun:test"
import { canvasWsUrl } from "./canvasUrl"

describe("canvasWsUrl — brainstorm board", () => {
  it("maps http → ws and points at the session-scoped board route with the document in ?path=", () => {
    const url = canvasWsUrl({
      baseUrl: "http://localhost:8787",
      ref: { short: "abc123", path: "brainstorms/auth-flow.canvas" },
    })
    const u = new URL(url)
    expect(u.protocol).toBe("ws:")
    expect(u.pathname).toBe("/sessions/abc123/brainstorms/canvas/ws")
    expect(u.searchParams.get("path")).toBe("brainstorms/auth-flow.canvas")
  })

  it("maps https → wss for secure deployments", () => {
    const url = canvasWsUrl({
      baseUrl: "https://daemon.example",
      ref: { short: "x", path: "a.canvas" },
    })
    expect(new URL(url).protocol).toBe("wss:")
  })

  it("keeps a base path prefix (e.g. the /__api tunnel proxy) in front of the route, query intact", () => {
    const url = canvasWsUrl({
      baseUrl: "https://abc.trycloudflare.com/__api",
      ref: { short: "s", path: "docs/a b.canvas" },
    })
    const u = new URL(url)
    expect(u.protocol).toBe("wss:")
    expect(u.host).toBe("abc.trycloudflare.com")
    expect(u.pathname).toBe("/__api/sessions/s/brainstorms/canvas/ws")
    expect(u.searchParams.get("path")).toBe("docs/a b.canvas")
  })
})
