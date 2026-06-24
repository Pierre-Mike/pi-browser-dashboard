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
    expect(resolveCorsOrigin("http://localhost:5173", {})).toBe("http://localhost:5173")
  })

  it("echoes an injected PID_CORS_ORIGINS origin", () => {
    expect(resolveCorsOrigin("views://mainview", { PID_CORS_ORIGINS: "views://mainview" })).toBe(
      "views://mainview",
    )
  })

  it("denies an unknown origin", () => {
    expect(resolveCorsOrigin("https://evil.test", {})).toBeNull()
  })

  it("allows any views:// origin only when PID_ALLOW_VIEWS_ORIGIN=1", () => {
    expect(resolveCorsOrigin("views://mainview/index.html", { PID_ALLOW_VIEWS_ORIGIN: "1" })).toBe(
      "views://mainview/index.html",
    )
    expect(resolveCorsOrigin("views://mainview", {})).toBeNull()
  })
})
