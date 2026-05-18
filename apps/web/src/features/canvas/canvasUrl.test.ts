import { describe, expect, it } from "bun:test"
import { canvasWsUrl } from "./canvasUrl"

describe("canvasWsUrl", () => {
  it("maps http → ws and points at /canvas/<id>/ws", () => {
    const url = canvasWsUrl({ baseUrl: "http://localhost:8787", id: "abc123" })
    const u = new URL(url)
    expect(u.protocol).toBe("ws:")
    expect(u.pathname).toBe("/canvas/abc123/ws")
  })

  it("maps https → wss for secure deployments", () => {
    const url = canvasWsUrl({ baseUrl: "https://daemon.example", id: "x" })
    const u = new URL(url)
    expect(u.protocol).toBe("wss:")
    expect(u.pathname).toBe("/canvas/x/ws")
  })
})
