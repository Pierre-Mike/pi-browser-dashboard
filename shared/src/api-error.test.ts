import { describe, expect, it } from "bun:test"
import { decodeApiErrorBody, isApiErrorBody } from "./api-error"

describe("decodeApiErrorBody", () => {
  it("accepts the bare tag the daemon emits most often", () => {
    expect(decodeApiErrorBody({ error: "invalid_body" }).error).toBe("invalid_body")
  })

  it("keeps the tag-specific payload — the record is open on purpose", () => {
    const decoded = decodeApiErrorBody({ error: "not_found", short: "abc123" })
    expect(decoded.error).toBe("not_found")
    expect(decoded.short).toBe("abc123")
  })

  it("accepts an optional human message alongside the tag", () => {
    const decoded = decodeApiErrorBody({ error: "bad_request", message: "id must be non-empty" })
    expect(decoded.message).toBe("id must be non-empty")
  })

  it("rejects a body with no tag at all", () => {
    expect(() => decodeApiErrorBody({ message: "something went wrong" })).toThrow()
  })

  // The legacy shape this contract exists to squeeze out: passing a decoded
  // Either left straight through puts an object where clients expect a tag.
  it("rejects an object in `error`, the legacy passthrough shape", () => {
    expect(() => decodeApiErrorBody({ error: { _tag: "ParseError" } })).toThrow()
  })
})

describe("isApiErrorBody", () => {
  it("narrows a success body away", () => {
    expect(isApiErrorBody({ ok: true })).toBe(false)
    expect(isApiErrorBody({ error: "not_found" })).toBe(true)
  })
})
