import { describe, expect, it } from "bun:test"
import { parseFlag, serializeFlag } from "./collapse"

describe("parseFlag", () => {
  it('is true only for the stored "1" sentinel', () => {
    expect(parseFlag("1")).toBe(true)
  })
  it("is false for null, empty, or any other value", () => {
    expect(parseFlag(null)).toBe(false)
    expect(parseFlag("")).toBe(false)
    expect(parseFlag("0")).toBe(false)
    expect(parseFlag("true")).toBe(false)
  })
})

describe("serializeFlag", () => {
  it("round-trips through parseFlag for both booleans", () => {
    expect(parseFlag(serializeFlag(true))).toBe(true)
    expect(parseFlag(serializeFlag(false))).toBe(false)
  })
})
