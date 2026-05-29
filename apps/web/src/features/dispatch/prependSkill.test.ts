import { describe, expect, it } from "bun:test"
import { prependSkill } from "./prependSkill"

describe("prependSkill", () => {
  it("returns the intent unchanged when no skills are given", () => {
    expect(prependSkill([], "do the thing")).toBe("do the thing")
  })

  it("trims surrounding whitespace from each skill name", () => {
    expect(prependSkill(["  goal  "], "do the thing")).toBe("/goal do the thing")
  })

  it("drops whitespace-only skills", () => {
    expect(prependSkill(["   ", "goal"], "do the thing")).toBe("/goal do the thing")
  })

  it("prepends /skill with a separating space in the normal case", () => {
    expect(prependSkill(["goal"], "ship the feature")).toBe("/goal ship the feature")
  })

  it("prepends multiple skills in order", () => {
    expect(prependSkill(["goal", "concise"], "ship the feature")).toBe(
      "/goal /concise ship the feature",
    )
  })

  it("returns just the slash commands when intent is empty", () => {
    expect(prependSkill(["goal"], "")).toBe("/goal")
    expect(prependSkill(["goal", "concise"], "")).toBe("/goal /concise")
  })

  it("dedupes repeated skills, keeping first occurrence order", () => {
    expect(prependSkill(["goal", "goal", "concise"], "go")).toBe("/goal /concise go")
  })

  it("leaves the intent alone when it already starts with a slash command", () => {
    expect(prependSkill(["goal"], "/review the PR")).toBe("/review the PR")
  })

  it("leaves the intent alone when it starts with whitespace then a slash", () => {
    expect(prependSkill(["goal"], "   /review the PR")).toBe("   /review the PR")
  })
})
