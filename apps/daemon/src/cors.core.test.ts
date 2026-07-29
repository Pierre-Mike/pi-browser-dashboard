import { describe, expect, it } from "bun:test"
import { allowedOriginList, resolveCorsOrigin } from "./cors.core"

describe("allowedOriginList", () => {
  it("always includes the dev origin", () => {
    expect(allowedOriginList({})).toEqual(["http://localhost:5173"])
  })

  it("appends trimmed, non-empty PID_CORS_ORIGINS entries", () => {
    expect(allowedOriginList({ PID_CORS_ORIGINS: "https://a.test, , https://b.test " })).toEqual([
      "http://localhost:5173",
      "https://a.test",
      "https://b.test",
    ])
  })
})

describe("resolveCorsOrigin", () => {
  it("echoes an allow-listed origin", () => {
    expect(resolveCorsOrigin({ requestOrigin: "http://localhost:5173", env: {} })).toBe(
      "http://localhost:5173",
    )
  })

  it("echoes an injected PID_CORS_ORIGINS origin", () => {
    expect(
      resolveCorsOrigin({
        requestOrigin: "https://tunnel.test",
        env: { PID_CORS_ORIGINS: "https://tunnel.test" },
      }),
    ).toBe("https://tunnel.test")
  })

  it("denies an unknown origin", () => {
    expect(resolveCorsOrigin({ requestOrigin: "https://evil.test", env: {} })).toBeNull()
  })

  it("denies a custom-scheme origin — only the explicit allow-list opens the door", () => {
    expect(resolveCorsOrigin({ requestOrigin: "views://mainview", env: {} })).toBeNull()
    expect(
      resolveCorsOrigin({
        requestOrigin: "app://anything",
        env: { PID_CORS_ORIGINS: "https://a.test" },
      }),
    ).toBeNull()
  })
})
