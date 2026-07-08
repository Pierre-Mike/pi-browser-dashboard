import { describe, expect, it } from "bun:test"
import { prependSkill } from "./prependSkill"

describe("prependSkill", () => {
  it("returns the intent unchanged when no skills are given", () => {
    expect(prependSkill({ skills: [], intent: "do the thing" })).toBe("do the thing")
  })

  it("trims surrounding whitespace from each skill name", () => {
    expect(prependSkill({ skills: ["  goal  "], intent: "do the thing" })).toBe(
      "/goal do the thing",
    )
  })

  it("drops whitespace-only skills", () => {
    expect(prependSkill({ skills: ["   ", "goal"], intent: "do the thing" })).toBe(
      "/goal do the thing",
    )
  })

  it("prepends /skill with a separating space in the normal case", () => {
    expect(prependSkill({ skills: ["goal"], intent: "ship the feature" })).toBe(
      "/goal ship the feature",
    )
  })

  it("prepends multiple skills in order", () => {
    expect(prependSkill({ skills: ["goal", "concise"], intent: "ship the feature" })).toBe(
      "/goal /concise ship the feature",
    )
  })

  it("returns just the slash commands when intent is empty", () => {
    expect(prependSkill({ skills: ["goal"], intent: "" })).toBe("/goal")
    expect(prependSkill({ skills: ["goal", "concise"], intent: "" })).toBe("/goal /concise")
  })

  it("dedupes repeated skills, keeping first occurrence order", () => {
    expect(prependSkill({ skills: ["goal", "goal", "concise"], intent: "go" })).toBe(
      "/goal /concise go",
    )
  })

  it("leaves the intent alone when it already starts with a slash command", () => {
    expect(prependSkill({ skills: ["goal"], intent: "/review the PR" })).toBe("/review the PR")
  })

  it("leaves the intent alone when it starts with whitespace then a slash", () => {
    expect(prependSkill({ skills: ["goal"], intent: "   /review the PR" })).toBe(
      "   /review the PR",
    )
  })

  describe("harness prefix", () => {
    it("uses the pi /skill: prefix when given", () => {
      expect(prependSkill({ skills: ["goal"], intent: "ship it", skillPrefix: "/skill:" })).toBe(
        "/skill:goal ship it",
      )
    })

    it("applies the prefix to every selected skill in order", () => {
      expect(
        prependSkill({ skills: ["goal", "concise"], intent: "go", skillPrefix: "/skill:" }),
      ).toBe("/skill:goal /skill:concise go")
    })

    it("still leaves an intent that already starts with a slash command alone", () => {
      expect(
        prependSkill({ skills: ["goal"], intent: "/skill:review go", skillPrefix: "/skill:" }),
      ).toBe("/skill:review go")
    })
  })

  // Guard consistency: the submit-button disabled condition must use
  // prependSkill({skills, intent}).trim().length === 0 so that selecting a
  // skill with an empty intent text box still produces a non-empty
  // dispatchable string.
  describe("guard consistency — skills selected, intent empty", () => {
    it("produces a non-empty string when a skill is selected with empty intent", () => {
      expect(prependSkill({ skills: ["goal"], intent: "" }).trim().length).toBeGreaterThan(0)
    })

    it("produces a non-empty string when multiple skills are selected with empty intent", () => {
      expect(
        prependSkill({ skills: ["goal", "concise"], intent: "" }).trim().length,
      ).toBeGreaterThan(0)
    })

    it("produces an empty string only when no skills AND empty intent", () => {
      expect(prependSkill({ skills: [], intent: "" }).trim().length).toBe(0)
    })
  })
})
