import { describe, expect, it } from "bun:test"
import { parsePeekSummary } from "./sessionPeek"

describe("parsePeekSummary", () => {
  it("returns the trimmed summary the daemon sent", () => {
    expect(parsePeekSummary({ summary: "  waiting on a review  " })).toBe("waiting on a review")
  })

  it("reads a blank or whitespace-only summary as (empty)", () => {
    expect(parsePeekSummary({ summary: "" })).toBe("(empty)")
    expect(parsePeekSummary({ summary: "   \n " })).toBe("(empty)")
  })

  it("reads a missing or wrong-typed summary field as (empty) instead of crashing", () => {
    // The old code cast the body to `{ summary?: string }`, so a number or a
    // null body reached the UI as-is and rendered garbage.
    expect(parsePeekSummary({})).toBe("(empty)")
    expect(parsePeekSummary({ summary: 42 })).toBe("(empty)")
    expect(parsePeekSummary({ summary: null })).toBe("(empty)")
  })

  it("survives a body that is not an object at all", () => {
    for (const raw of [null, undefined, "nope", 7, []]) {
      expect(parsePeekSummary(raw)).toBe("(empty)")
    }
  })
})
