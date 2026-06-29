import { describe, expect, it } from "bun:test"
import { removeSkillGroup } from "./skillGroups"
import type { SkillGroup } from "./types"

const groups: readonly SkillGroup[] = [
  { name: "A", skills: ["x"] },
  { name: "B", skills: ["y"] },
]

describe("removeSkillGroup", () => {
  it("drops the named group, leaving the rest in order", () => {
    expect(removeSkillGroup(groups, "A")).toEqual([{ name: "B", skills: ["y"] }])
  })

  it("is a no-op when the name is absent", () => {
    expect(removeSkillGroup(groups, "missing")).toEqual(groups)
  })
})
