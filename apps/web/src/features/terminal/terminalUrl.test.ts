import { describe, expect, it } from "bun:test"
import { terminalKillUrl, terminalWsUrl } from "./terminalUrl"

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

  it("preserves a base path prefix (e.g. the /__api tunnel proxy) before the route", () => {
    const url = terminalWsUrl({
      baseUrl: "https://abc.trycloudflare.com/__api",
      kind: "global",
      cols: 80,
      rows: 24,
    })
    const u = new URL(url)
    expect(u.protocol).toBe("wss:")
    expect(u.host).toBe("abc.trycloudflare.com")
    expect(u.pathname).toBe("/__api/terminal/global")
  })

  it("routes the orchestrator kind to /terminal/orchestrator with no id segment", () => {
    const url = terminalWsUrl({
      baseUrl: "http://localhost:8787",
      kind: "orchestrator",
      cols: 100,
      rows: 30,
    })
    const u = new URL(url)
    expect(u.protocol).toBe("ws:")
    expect(u.pathname).toBe("/terminal/orchestrator")
    expect(u.searchParams.get("cols")).toBe("100")
    expect(u.searchParams.get("rows")).toBe("30")
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

describe("terminalKillUrl", () => {
  it("DELETE target for sessions: http(s) + /terminal/<id> + no query", () => {
    // Restart button hits DELETE — must NOT be ws://, and the WS dim query
    // must not leak through (the daemon's DELETE handler ignores it but a
    // stray "?cols=" upstream is noise).
    const url = terminalKillUrl({ baseUrl: "http://localhost:8787", kind: "session", id: "abc" })
    const u = new URL(url)
    expect(u.protocol).toBe("http:")
    expect(u.pathname).toBe("/terminal/abc")
    expect(u.search).toBe("")
  })

  it("DELETE target for projects: /terminal/project/<id>", () => {
    const url = terminalKillUrl({ baseUrl: "http://x", kind: "project", id: "my-repo" })
    expect(new URL(url).pathname).toBe("/terminal/project/my-repo")
  })

  it("DELETE target for the global terminal: /terminal/global", () => {
    const url = terminalKillUrl({ baseUrl: "http://x", kind: "global" })
    expect(new URL(url).pathname).toBe("/terminal/global")
  })

  it("DELETE target for the orchestrator terminal: /terminal/orchestrator", () => {
    const url = terminalKillUrl({ baseUrl: "http://x", kind: "orchestrator" })
    expect(new URL(url).pathname).toBe("/terminal/orchestrator")
  })

  it("preserves https → https (does NOT cross over to ws/wss like the WS builder)", () => {
    const url = terminalKillUrl({ baseUrl: "https://daemon.example", kind: "global" })
    expect(new URL(url).protocol).toBe("https:")
  })

  it("preserves a base path prefix (e.g. the /__api tunnel proxy)", () => {
    const url = terminalKillUrl({ baseUrl: "https://abc.trycloudflare.com/__api", kind: "global" })
    const u = new URL(url)
    expect(u.pathname).toBe("/__api/terminal/global")
    expect(u.search).toBe("")
  })
})
