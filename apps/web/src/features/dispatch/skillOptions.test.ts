import { describe, expect, it } from "bun:test"
import { mergeSkillOptions } from "./skillOptions"

describe("mergeSkillOptions", () => {
  it("returns just the default when no skills are loaded", () => {
    expect(mergeSkillOptions({ defaultSkill: "goal" })).toEqual(["goal"])
  })

  it("surfaces the default first even when global skills exist", () => {
    expect(
      mergeSkillOptions({ defaultSkill: "goal", globalSkills: [{ id: "align" }, { id: "goal" }] }),
    ).toEqual(["goal", "align"])
  })

  it("includes project (local) skills after global ones", () => {
    expect(
      mergeSkillOptions({
        defaultSkill: "goal",
        globalSkills: [{ id: "align" }],
        projectSkills: [{ id: "deploy" }, { id: "lint" }],
      }),
    ).toEqual(["goal", "align", "deploy", "lint"])
  })

  it("includes local skills even when there are no global skills", () => {
    expect(
      mergeSkillOptions({
        defaultSkill: "goal",
        globalSkills: [],
        projectSkills: [{ id: "deploy" }],
      }),
    ).toEqual(["goal", "deploy"])
  })

  it("dedupes a project skill that shares an id with a global skill", () => {
    expect(
      mergeSkillOptions({
        defaultSkill: "goal",
        globalSkills: [{ id: "align" }],
        projectSkills: [{ id: "align" }, { id: "deploy" }],
      }),
    ).toEqual(["goal", "align", "deploy"])
  })

  it("dedupes a local skill named like the default", () => {
    expect(
      mergeSkillOptions({
        defaultSkill: "goal",
        globalSkills: [],
        projectSkills: [{ id: "goal" }, { id: "deploy" }],
      }),
    ).toEqual(["goal", "deploy"])
  })

  it("surfaces pinned skills after the default, before global/project skills", () => {
    expect(
      mergeSkillOptions({
        defaultSkill: "goal",
        pinned: ["align"],
        globalSkills: [{ id: "deploy" }],
      }),
    ).toEqual(["goal", "align", "deploy"])
  })

  it("dedupes a pinned skill that equals the default or a loaded skill", () => {
    expect(
      mergeSkillOptions({
        defaultSkill: "goal",
        pinned: ["goal", "deploy"],
        globalSkills: [{ id: "deploy" }],
      }),
    ).toEqual(["goal", "deploy"])
  })
})
