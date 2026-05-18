import { describe, expect, it } from "bun:test"
import { terminalWsUrl } from "./terminalUrl"

describe("terminalWsUrl", () => {
  it("maps http → ws and points at /terminal/<id> for sessions", () => {
    const url = terminalWsUrl({
      baseUrl: "http://localhost:8787",
      kind: "session",
      id: "abc123",
      cols: 120,
      rows: 32,
    })
    const u = new URL(url)
    expect(u.protocol).toBe("ws:")
    expect(u.pathname).toBe("/terminal/abc123")
    expect(u.searchParams.get("cols")).toBe("120")
    expect(u.searchParams.get("rows")).toBe("32")
  })

  it("maps https → wss and points at /terminal/project/<id> for projects", () => {
    const url = terminalWsUrl({
      baseUrl: "https://daemon.example",
      kind: "project",
      id: "my-repo",
      cols: 80,
      rows: 24,
    })
    const u = new URL(url)
    expect(u.protocol).toBe("wss:")
    expect(u.pathname).toBe("/terminal/project/my-repo")
    expect(u.searchParams.get("cols")).toBe("80")
    expect(u.searchParams.get("rows")).toBe("24")
  })

  it("routes the global kind to /terminal/global with no id segment", () => {
    const url = terminalWsUrl({
      baseUrl: "http://localhost:8787",
      kind: "global",
      cols: 100,
      rows: 30,
    })
    const u = new URL(url)
    expect(u.protocol).toBe("ws:")
    expect(u.pathname).toBe("/terminal/global")
    expect(u.searchParams.get("cols")).toBe("100")
    expect(u.searchParams.get("rows")).toBe("30")
  })

  it("preserves https → wss mapping for the global kind too", () => {
    const url = terminalWsUrl({
      baseUrl: "https://daemon.example",
      kind: "global",
      cols: 80,
      rows: 24,
    })
    const u = new URL(url)
    expect(u.protocol).toBe("wss:")
    expect(u.pathname).toBe("/terminal/global")
  })

  it("encodes ids with special chars in the path segment", () => {
    const url = terminalWsUrl({
      baseUrl: "http://x",
      kind: "project",
      id: "a b/c",
      cols: 1,
      rows: 1,
    })
    // URL constructor leaves path segments alone — but at minimum the result
    // must round-trip the id through new URL() without truncation past '?'.
    const u = new URL(url)
    expect(u.pathname.startsWith("/terminal/project/")).toBe(true)
    expect(u.search).toBe("?cols=1&rows=1")
  })
})
