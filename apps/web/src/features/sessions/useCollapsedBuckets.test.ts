import { describe, expect, it } from "bun:test"
import { parseCollapsedKeys, toggleKey } from "./useCollapsedBuckets"

describe("parseCollapsedKeys", () => {
  it("round-trips a JSON array of bucket keys", () => {
    expect(parseCollapsedKeys(JSON.stringify(["p:a", "c:/x/y"]))).toEqual(
      new Set(["p:a", "c:/x/y"]),
    )
  })
  it("returns an empty set for null, malformed JSON, or non-arrays", () => {
    expect(parseCollapsedKeys(null)).toEqual(new Set())
    expect(parseCollapsedKeys("{not json")).toEqual(new Set())
    expect(parseCollapsedKeys('{"a":1}')).toEqual(new Set())
  })
  it("drops non-string entries", () => {
    expect(parseCollapsedKeys('["p:a", 7, null]')).toEqual(new Set(["p:a"]))
  })
})

describe("toggleKey", () => {
  it("adds a missing key and removes a present one", () => {
    const once = toggleKey(new Set(), "p:a")
    expect(once.has("p:a")).toBe(true)
    const twice = toggleKey(once, "p:a")
    expect(twice.has("p:a")).toBe(false)
  })
  it("does not mutate the input set", () => {
    const input = new Set(["p:a"])
    toggleKey(input, "p:b")
    expect(input).toEqual(new Set(["p:a"]))
  })
})
