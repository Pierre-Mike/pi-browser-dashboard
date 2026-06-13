import { describe, expect, test } from "bun:test"
import { resolveSessionView } from "./sessionView"

describe("resolveSessionView", () => {
  test("loading while the first fetch is in flight", () => {
    expect(resolveSessionView({ isLoading: true, data: undefined })).toBe("loading")
  })

  test("not-found once the query resolves to null (invalid id → 404)", () => {
    expect(resolveSessionView({ isLoading: false, data: null })).toBe("not-found")
  })

  test("not-found when settled with undefined data", () => {
    expect(resolveSessionView({ isLoading: false, data: undefined })).toBe("not-found")
  })

  test("ready when a session object is present", () => {
    expect(resolveSessionView({ isLoading: false, data: { short: "abc123" } })).toBe("ready")
  })

  test("loading takes precedence even if stale data is null", () => {
    expect(resolveSessionView({ isLoading: true, data: null })).toBe("loading")
  })
})
