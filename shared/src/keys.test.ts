import { describe, expect, it } from "bun:test"
import { isNamedKey, NAMED_KEYS } from "./keys"

describe("isNamedKey", () => {
  it("accepts every name in the vocabulary", () => {
    for (const name of NAMED_KEYS) expect(isNamedKey(name)).toBe(true)
  })

  it("rejects a name that is not in the vocabulary", () => {
    expect(isNamedKey("ctrl-c")).toBe(false)
    expect(isNamedKey("Enter")).toBe(false)
  })

  it("rejects non-strings without throwing", () => {
    expect(isNamedKey(undefined)).toBe(false)
    expect(isNamedKey(13)).toBe(false)
    expect(isNamedKey({ named: "enter" })).toBe(false)
  })
})

describe("NAMED_KEYS", () => {
  it("has no duplicates", () => {
    expect(new Set(NAMED_KEYS).size).toBe(NAMED_KEYS.length)
  })

  // `ctrl-c` and `ctrl-d` are deliberately absent: `POST /:id/stop` is the
  // supported, observable way to end a session, and a ctrl-c smuggled through
  // "just another keystroke" would end one invisibly. Asserting the omission
  // keeps a future well-meaning addition from being a silent behaviour change.
  it("omits the session-ending control keys on purpose", () => {
    expect(isNamedKey("ctrl-c")).toBe(false)
    expect(isNamedKey("ctrl-d")).toBe(false)
  })
})
