import { describe, expect, it } from "bun:test"
import { resolveStaticRel, staticMime } from "./static-web.core"

describe("resolveStaticRel", () => {
  it("resolves the root path to index.html", () => {
    expect(resolveStaticRel("/")).toBe("index.html")
  })

  it("resolves an asset path verbatim", () => {
    expect(resolveStaticRel("/assets/index-abc123.js")).toBe("assets/index-abc123.js")
  })

  it("falls back to index.html for an extensionless SPA route (client-side router)", () => {
    expect(resolveStaticRel("/sessions/abc123")).toBe("index.html")
    expect(resolveStaticRel("/dispatch")).toBe("index.html")
  })

  it("decodes percent-encoded paths before resolving", () => {
    expect(resolveStaticRel("/assets/a%20b.css")).toBe("assets/a b.css")
  })

  it("rejects a bad percent-encoding", () => {
    expect(resolveStaticRel("/%E0%A4%A")).toBeNull()
  })

  it("rejects traversal via ..", () => {
    expect(resolveStaticRel("/../secret.txt")).toBeNull()
    expect(resolveStaticRel("/assets/../../secret.txt")).toBeNull()
  })

  it("rejects encoded traversal", () => {
    expect(resolveStaticRel("/%2e%2e%2fsecret.txt")).toBeNull()
  })

  it("rejects backslash escapes", () => {
    expect(resolveStaticRel("/assets\\..\\secret.txt")).toBeNull()
  })
})

describe("staticMime", () => {
  it("maps common extensions", () => {
    expect(staticMime("index.html")).toBe("text/html; charset=utf-8")
    expect(staticMime("assets/app.js")).toBe("text/javascript; charset=utf-8")
    expect(staticMime("assets/app.css")).toBe("text/css; charset=utf-8")
    expect(staticMime("favicon.svg")).toBe("image/svg+xml")
  })

  it("defaults to octet-stream for an unknown extension", () => {
    expect(staticMime("weird.unknownext")).toBe("application/octet-stream")
  })
})
