import { describe, expect, it } from "bun:test"
import { mergeSkillOptions } from "./skillOptions"

describe("mergeSkillOptions", () => {
  it("returns just the default when no skills are loaded", () => {
    expect(mergeSkillOptions("goal")).toEqual(["goal"])
  })

  it("surfaces the default first even when global skills exist", () => {
    expect(mergeSkillOptions("goal", [{ id: "align" }, { id: "goal" }])).toEqual(["goal", "align"])
  })

  it("includes project (local) skills after global ones", () => {
    expect(
      mergeSkillOptions("goal", [{ id: "align" }], [{ id: "deploy" }, { id: "lint" }]),
    ).toEqual(["goal", "align", "deploy", "lint"])
  })

  it("includes local skills even when there are no global skills", () => {
    expect(mergeSkillOptions("goal", [], [{ id: "deploy" }])).toEqual(["goal", "deploy"])
  })

  it("dedupes a project skill that shares an id with a global skill", () => {
    expect(
      mergeSkillOptions("goal", [{ id: "align" }], [{ id: "align" }, { id: "deploy" }]),
    ).toEqual(["goal", "align", "deploy"])
  })

  it("dedupes a local skill named like the default", () => {
    expect(mergeSkillOptions("goal", [], [{ id: "goal" }, { id: "deploy" }])).toEqual([
      "goal",
      "deploy",
    ])
  })
})
