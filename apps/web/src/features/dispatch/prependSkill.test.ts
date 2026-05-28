import { describe, expect, it } from "bun:test"
import { prependSkill } from "./prependSkill"

describe("prependSkill", () => {
  it("returns the intent unchanged when skill is empty", () => {
    expect(prependSkill("", "do the thing")).toBe("do the thing")
  })

  it("trims surrounding whitespace from the skill name", () => {
    expect(prependSkill("  goal  ", "do the thing")).toBe("/goal do the thing")
  })

  it("treats whitespace-only skill as empty", () => {
    expect(prependSkill("   ", "do the thing")).toBe("do the thing")
  })

  it("prepends /skill with a separating space in the normal case", () => {
    expect(prependSkill("goal", "ship the feature")).toBe("/goal ship the feature")
  })

  it("returns just the slash command when intent is empty", () => {
    expect(prependSkill("goal", "")).toBe("/goal")
  })

  it("leaves the intent alone when it already starts with a slash command", () => {
    expect(prependSkill("goal", "/review the PR")).toBe("/review the PR")
  })

  it("leaves the intent alone when it starts with whitespace then a slash", () => {
    expect(prependSkill("goal", "   /review the PR")).toBe("   /review the PR")
  })
})
