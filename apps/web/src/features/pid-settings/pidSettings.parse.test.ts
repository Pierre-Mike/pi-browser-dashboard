import { describe, expect, it } from "bun:test"
import { parsePidSettings } from "./pidSettings.parse"

describe("parsePidSettings", () => {
  it("accepts a well-formed settings object", () => {
    expect(parsePidSettings({ defaultSkills: ["writing", "review"] })).toEqual({
      defaultSkills: ["writing", "review"],
    })
  })

  it("accepts an empty defaultSkills list", () => {
    expect(parsePidSettings({ defaultSkills: [] })).toEqual({ defaultSkills: [] })
  })

  it("rejects a missing or wrong-typed defaultSkills", () => {
    expect(parsePidSettings({})).toBeNull()
    expect(parsePidSettings({ defaultSkills: "writing" })).toBeNull()
    expect(parsePidSettings({ defaultSkills: [1, 2] })).toBeNull()
  })

  it("rejects a non-object", () => {
    expect(parsePidSettings(null)).toBeNull()
  })
})
