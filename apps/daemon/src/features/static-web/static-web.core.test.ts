import { describe, expect, it } from "bun:test"
import { resolveStaticRel } from "./static-web.core"

// `staticMime` and its 16-entry table used to be tested here. Both were folded
// into `platform/http-content.core`'s `mimeFromPath`; the content types this
// slice now serves are asserted through the real route in
// static-web.routes.test.ts, which is where the behaviour change is visible.

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
