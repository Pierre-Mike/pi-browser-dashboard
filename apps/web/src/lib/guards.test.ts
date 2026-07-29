import { describe, expect, it } from "bun:test"
import {
  isArrayOf,
  isBoolean,
  isNumber,
  isRecord,
  isString,
  isStringArray,
  parseArray,
} from "./guards"

describe("isRecord", () => {
  it("accepts a plain object", () => {
    expect(isRecord({ a: 1 })).toBe(true)
  })
  it("rejects arrays, null, and primitives", () => {
    expect(isRecord([])).toBe(false)
    expect(isRecord(null)).toBe(false)
    expect(isRecord("x")).toBe(false)
    expect(isRecord(undefined)).toBe(false)
  })
})

describe("isString / isNumber / isBoolean", () => {
  it("narrow only their own primitive", () => {
    expect(isString("x")).toBe(true)
    expect(isString(1)).toBe(false)
    expect(isNumber(1)).toBe(true)
    expect(isNumber("1")).toBe(false)
    expect(isBoolean(true)).toBe(true)
    expect(isBoolean(0)).toBe(false)
  })
})

describe("isArrayOf / isStringArray", () => {
  it("accepts an array whose every element passes the guard", () => {
    expect(isArrayOf(["a", "b"], isString)).toBe(true)
    expect(isStringArray(["a", "b"])).toBe(true)
  })
  it("rejects a mixed or non-array value", () => {
    expect(isStringArray(["a", 1])).toBe(false)
    expect(isStringArray("a")).toBe(false)
    expect(isStringArray(null)).toBe(false)
  })
  it("accepts an empty array", () => {
    expect(isStringArray([])).toBe(true)
  })
})

describe("parseArray", () => {
  const parseEvenNumber = (v: unknown): number | null =>
    typeof v === "number" && v % 2 === 0 ? v : null

  it("parses every element with the given parser", () => {
    expect(parseArray([2, 4, 6], parseEvenNumber)).toEqual([2, 4, 6])
  })
  it("fails the whole list when one element fails", () => {
    expect(parseArray([2, 3, 4], parseEvenNumber)).toBeNull()
  })
  it("fails on a non-array input", () => {
    expect(parseArray("nope", parseEvenNumber)).toBeNull()
  })
  it("returns an empty array for an empty input", () => {
    expect(parseArray([], parseEvenNumber)).toEqual([])
  })
})
