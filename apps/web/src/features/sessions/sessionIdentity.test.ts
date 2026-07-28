import { describe, expect, it } from "bun:test"
import { sessionIdentity } from "./sessionIdentity"

describe("sessionIdentity", () => {
  it("titles a named session by its name and keeps the short id as a chip", () => {
    expect(sessionIdentity({ name: "fix the ratchet", short: "ab12cd34" })).toEqual({
      label: "fix the ratchet",
      chip: "ab12cd34",
    })
  })

  it("titles an unnamed session by its short id", () => {
    // The daemon stores "" until the first prompt lands. The old header used
    // `session?.name ?? id`, which keeps "" (?? only catches null/undefined) and
    // rendered a blank title.
    expect(sessionIdentity({ name: "", short: "ab12cd34" })).toEqual({
      label: "ab12cd34",
      chip: null,
    })
  })

  it("treats a whitespace-only name as unnamed", () => {
    expect(sessionIdentity({ name: "   ", short: "ab12cd34" }).label).toBe("ab12cd34")
  })

  it("survives an absent name field", () => {
    // Regression: `SessionState.name` is typed `string`, but the daemon omits it
    // for a never-named session — a bare `name.trim()` crashed the whole
    // drill-in with "Cannot read properties of undefined".
    expect(sessionIdentity({ short: "ab12cd34" })).toEqual({ label: "ab12cd34", chip: null })
    expect(sessionIdentity({ name: undefined, short: "ab12cd34" }).label).toBe("ab12cd34")
  })

  it("trims the surrounding whitespace off a real name", () => {
    expect(sessionIdentity({ name: "  ship the dock  ", short: "ab12cd34" }).label).toBe(
      "ship the dock",
    )
  })

  it("drops the chip when the name IS the short id, so it is not printed twice", () => {
    expect(sessionIdentity({ name: "ab12cd34", short: "ab12cd34" })).toEqual({
      label: "ab12cd34",
      chip: null,
    })
  })
})
