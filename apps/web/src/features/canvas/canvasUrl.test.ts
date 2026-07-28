import { describe, expect, it } from "bun:test"
import { canvasWsUrl } from "./canvasUrl"

describe("canvasWsUrl — session canvas", () => {
  it("maps http → ws and points at /canvas/<id>/ws", () => {
    const url = canvasWsUrl({
      baseUrl: "http://localhost:8787",
      ref: { kind: "session", short: "abc123" },
    })
    const u = new URL(url)
    expect(u.protocol).toBe("ws:")
    expect(u.pathname).toBe("/canvas/abc123/ws")
  })

  it("maps https → wss for secure deployments", () => {
    const url = canvasWsUrl({
      baseUrl: "https://daemon.example",
      ref: { kind: "session", short: "x" },
    })
    const u = new URL(url)
    expect(u.protocol).toBe("wss:")
    expect(u.pathname).toBe("/canvas/x/ws")
  })

  it("preserves a base path prefix (e.g. the /__api tunnel proxy)", () => {
    const url = canvasWsUrl({
      baseUrl: "https://abc.trycloudflare.com/__api",
      ref: { kind: "session", short: "x" },
    })
    const u = new URL(url)
    expect(u.protocol).toBe("wss:")
    expect(u.host).toBe("abc.trycloudflare.com")
    expect(u.pathname).toBe("/__api/canvas/x/ws")
  })
})

describe("canvasWsUrl — brainstorm board", () => {
  it("points at the session-scoped board route with the document in ?path=", () => {
    const url = canvasWsUrl({
      baseUrl: "http://localhost:8787",
      ref: { kind: "board", short: "abc123", path: "brainstorms/auth-flow.canvas" },
    })
    const u = new URL(url)
    expect(u.protocol).toBe("ws:")
    expect(u.pathname).toBe("/sessions/abc123/brainstorms/canvas/ws")
    expect(u.searchParams.get("path")).toBe("brainstorms/auth-flow.canvas")
  })

  it("keeps the /__api prefix in front of the board route, query intact", () => {
    const url = canvasWsUrl({
      baseUrl: "https://abc.trycloudflare.com/__api",
      ref: { kind: "board", short: "s", path: "docs/a b.canvas" },
    })
    const u = new URL(url)
    expect(u.pathname).toBe("/__api/sessions/s/brainstorms/canvas/ws")
    expect(u.searchParams.get("path")).toBe("docs/a b.canvas")
  })
})
