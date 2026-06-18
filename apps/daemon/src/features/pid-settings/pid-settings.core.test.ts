import { describe, expect, it } from "bun:test"
import {
  DEFAULT_PID_SETTINGS,
  mergePidSettings,
  parsePidSettings,
  serializePidSettings,
} from "./pid-settings.core"

describe("parsePidSettings", () => {
  it("returns defaults for empty / nullish input", () => {
    expect(parsePidSettings("")).toEqual(DEFAULT_PID_SETTINGS)
    expect(parsePidSettings("   ")).toEqual(DEFAULT_PID_SETTINGS)
    expect(parsePidSettings(null)).toEqual(DEFAULT_PID_SETTINGS)
    expect(parsePidSettings(undefined)).toEqual(DEFAULT_PID_SETTINGS)
  })

  it("returns defaults for malformed JSON or non-object roots", () => {
    expect(parsePidSettings("{not json")).toEqual(DEFAULT_PID_SETTINGS)
    expect(parsePidSettings("[1,2,3]")).toEqual(DEFAULT_PID_SETTINGS)
    expect(parsePidSettings('"a string"')).toEqual(DEFAULT_PID_SETTINGS)
  })

  it("reads defaultSkills when present", () => {
    expect(parsePidSettings('{"defaultSkills":["align","tdd"]}')).toEqual({
      defaultSkills: ["align", "tdd"],
    })
  })

  it("falls back per-field when defaultSkills is the wrong type", () => {
    expect(parsePidSettings('{"defaultSkills":"goal"}')).toEqual(DEFAULT_PID_SETTINGS)
  })

  it("normalizes skills: trims, strips leading slash, drops empties, dedupes", () => {
    expect(parsePidSettings('{"defaultSkills":[" /goal ","goal","",2,"align"]}')).toEqual({
      defaultSkills: ["goal", "align"],
    })
  })

  it("accepts an explicit empty list (no default selection)", () => {
    expect(parsePidSettings('{"defaultSkills":[]}')).toEqual({ defaultSkills: [] })
  })
})

describe("mergePidSettings", () => {
  const base = { defaultSkills: ["goal"] }

  it("returns current unchanged for nullish / non-object patches", () => {
    expect(mergePidSettings(base, null)).toEqual(base)
    expect(mergePidSettings(base, undefined)).toEqual(base)
  })

  it("overrides defaultSkills when the patch provides a valid value", () => {
    expect(mergePidSettings(base, { defaultSkills: ["align"] })).toEqual({
      defaultSkills: ["align"],
    })
  })

  it("keeps current value when the patch omits the field", () => {
    expect(mergePidSettings(base, {})).toEqual(base)
  })

  it("ignores an invalid patch value (current wins)", () => {
    expect(mergePidSettings(base, { defaultSkills: "nope" as unknown as string[] })).toEqual(base)
  })

  it("allows clearing the selection with an empty list", () => {
    expect(mergePidSettings(base, { defaultSkills: [] })).toEqual({ defaultSkills: [] })
  })
})

describe("serializePidSettings", () => {
  it("round-trips through parse", () => {
    const s = { defaultSkills: ["align", "tdd"] }
    expect(parsePidSettings(serializePidSettings(s))).toEqual(s)
  })

  it("emits pretty JSON with a trailing newline", () => {
    const out = serializePidSettings({ defaultSkills: ["goal"] })
    expect(out.endsWith("\n")).toBe(true)
    expect(out).toContain('  "defaultSkills"')
  })
})
