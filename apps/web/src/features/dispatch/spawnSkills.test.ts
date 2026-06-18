import { describe, expect, it } from "bun:test"
import { resolveDefaultSkills, sameSkills, toggleSkill } from "./spawnSkills"

describe("sameSkills", () => {
  it("is true for identical sequences", () => {
    expect(sameSkills(["a", "b"], ["a", "b"])).toBe(true)
    expect(sameSkills([], [])).toBe(true)
  })

  it("is false on different length or order", () => {
    expect(sameSkills(["a"], ["a", "b"])).toBe(false)
    expect(sameSkills(["a", "b"], ["b", "a"])).toBe(false)
  })
})

describe("toggleSkill", () => {
  it("adds a missing id to the end", () => {
    expect(toggleSkill(["a"], "b")).toEqual(["a", "b"])
  })

  it("removes a present id, preserving order of the rest", () => {
    expect(toggleSkill(["a", "b", "c"], "b")).toEqual(["a", "c"])
  })

  it("does not mutate the input", () => {
    const input = ["a"]
    toggleSkill(input, "b")
    expect(input).toEqual(["a"])
  })
})

describe("resolveDefaultSkills", () => {
  it("falls back to the global default without a project", () => {
    expect(resolveDefaultSkills(false, undefined)).toEqual(["goal"])
    expect(resolveDefaultSkills(false, ["align"])).toEqual(["goal"])
  })

  it("uses the global default while project settings are still loading", () => {
    expect(resolveDefaultSkills(true, undefined)).toEqual(["goal"])
  })

  it("uses the project's stored default once loaded", () => {
    expect(resolveDefaultSkills(true, ["align", "tdd"])).toEqual(["align", "tdd"])
  })

  it("honors an explicit empty stored default", () => {
    expect(resolveDefaultSkills(true, [])).toEqual([])
  })
})
