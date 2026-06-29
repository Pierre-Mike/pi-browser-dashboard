import { describe, expect, it } from "bun:test"
import type { SkillGroup } from "../global-settings/types"
import { applyGroupToSelection, groupSkills, upsertSkillGroup } from "./skillGroups"

describe("applyGroupToSelection", () => {
  it("adds the group's skills to the current selection, preserving order", () => {
    expect(applyGroupToSelection(["goal"], ["tdd", "ts-axioms"])).toEqual([
      "goal",
      "tdd",
      "ts-axioms",
    ])
  })

  it("never duplicates a skill already selected (union, current picks kept)", () => {
    expect(applyGroupToSelection(["goal", "tdd"], ["tdd", "ts-axioms"])).toEqual([
      "goal",
      "tdd",
      "ts-axioms",
    ])
  })

  it("returns the group as-is when nothing is selected yet", () => {
    expect(applyGroupToSelection([], ["a", "b"])).toEqual(["a", "b"])
  })
})

describe("upsertSkillGroup", () => {
  const base: readonly SkillGroup[] = [{ name: "A", skills: ["x"] }]

  it("appends a new group", () => {
    expect(upsertSkillGroup(base, { name: "B", skills: ["y"] })).toEqual([
      { name: "A", skills: ["x"] },
      { name: "B", skills: ["y"] },
    ])
  })

  it("replaces an existing group by name in place", () => {
    expect(upsertSkillGroup(base, { name: "A", skills: ["z", "w"] })).toEqual([
      { name: "A", skills: ["z", "w"] },
    ])
  })

  it("trims the name before matching/storing", () => {
    expect(upsertSkillGroup(base, { name: "  A  ", skills: ["z"] })).toEqual([
      { name: "A", skills: ["z"] },
    ])
  })

  it("ignores a blank name or an empty skill list (no-op copy)", () => {
    expect(upsertSkillGroup(base, { name: "   ", skills: ["y"] })).toEqual(base)
    expect(upsertSkillGroup(base, { name: "C", skills: [] })).toEqual(base)
  })
})

describe("groupSkills", () => {
  const groups: readonly SkillGroup[] = [{ name: "A", skills: ["x", "y"] }]
  it("returns a group's skills by name, empty when absent", () => {
    expect(groupSkills(groups, "A")).toEqual(["x", "y"])
    expect(groupSkills(groups, "missing")).toEqual([])
  })
})
