import { describe, expect, it } from "bun:test"
import {
  DEFAULT_OUTPUT_ANCHOR,
  DEFAULT_WAIT_VIA,
  isOutputAnchor,
  isWaitSatisfiedVia,
  isWaitVia,
  OUTPUT_ANCHORS,
  OUTPUT_PATTERN_MAX_CHARS,
  WAIT_SATISFIED_VIA_VALUES,
  WAIT_VIA_VALUES,
} from "./wait"

describe("isWaitVia", () => {
  it("accepts every value in the vocabulary", () => {
    for (const via of WAIT_VIA_VALUES) expect(isWaitVia(via)).toBe(true)
  })

  it("rejects anything else, without throwing on a non-string", () => {
    expect(isWaitVia("Supervisor")).toBe(false)
    expect(isWaitVia("terminal")).toBe(false)
    expect(isWaitVia(undefined)).toBe(false)
    expect(isWaitVia(2)).toBe(false)
    expect(isWaitVia({ via: "screen" })).toBe(false)
  })

  it("defaults to supervisor, the reading that predates the screen", () => {
    expect(DEFAULT_WAIT_VIA).toBe("supervisor")
    expect(isWaitVia(DEFAULT_WAIT_VIA)).toBe(true)
  })
})

describe("isWaitSatisfiedVia", () => {
  it("accepts the two observations that can settle a wait", () => {
    for (const via of WAIT_SATISFIED_VIA_VALUES) expect(isWaitSatisfiedVia(via)).toBe(true)
  })

  // "either" asks the daemon to take whichever arrives first; reporting it back
  // would tell the caller nothing about which reading it actually got.
  it("rejects either — a request is not an answer", () => {
    expect(isWaitSatisfiedVia("either")).toBe(false)
  })

  it("stays a strict subset of the request vocabulary", () => {
    for (const via of WAIT_SATISFIED_VIA_VALUES) expect(isWaitVia(via)).toBe(true)
    expect(WAIT_SATISFIED_VIA_VALUES.length).toBeLessThan(WAIT_VIA_VALUES.length)
  })
})

describe("isOutputAnchor", () => {
  it("accepts every anchor in the vocabulary", () => {
    for (const anchor of OUTPUT_ANCHORS) expect(isOutputAnchor(anchor)).toBe(true)
  })

  it("rejects anything else, without throwing on a non-string", () => {
    expect(isOutputAnchor("line_start")).toBe(false)
    expect(isOutputAnchor("regex")).toBe(false)
    expect(isOutputAnchor(undefined)).toBe(false)
    expect(isOutputAnchor(4)).toBe(false)
  })

  it("defaults to anywhere, matching the bare-string shorthand", () => {
    expect(DEFAULT_OUTPUT_ANCHOR).toBe("anywhere")
    expect(isOutputAnchor(DEFAULT_OUTPUT_ANCHOR)).toBe(true)
  })
})

describe("vocabularies", () => {
  it("have no duplicates", () => {
    expect(new Set(WAIT_VIA_VALUES).size).toBe(WAIT_VIA_VALUES.length)
    expect(new Set(OUTPUT_ANCHORS).size).toBe(OUTPUT_ANCHORS.length)
  })

  // Both ends quote this number in a user-facing message, so a change here is a
  // change to two error strings and to what the daemon accepts.
  it("cap output patterns at 200 characters", () => {
    expect(OUTPUT_PATTERN_MAX_CHARS).toBe(200)
  })
})
