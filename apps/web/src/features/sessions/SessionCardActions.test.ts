import { describe, expect, it } from "bun:test"
import { parsePeekSummary } from "./SessionCardActions"

describe("parsePeekSummary", () => {
  it("extracts a string summary", () => {
    expect(parsePeekSummary({ summary: "Reading the transcript…" })).toBe("Reading the transcript…")
  })

  it("returns undefined when summary is missing, wrong-typed, or the body isn't an object", () => {
    expect(parsePeekSummary({})).toBeUndefined()
    expect(parsePeekSummary({ summary: 1 })).toBeUndefined()
    expect(parsePeekSummary(null)).toBeUndefined()
    expect(parsePeekSummary("done")).toBeUndefined()
  })
})
