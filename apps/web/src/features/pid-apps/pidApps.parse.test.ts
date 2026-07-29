import { describe, expect, it } from "bun:test"
import { parsePidApp, parsePidApps } from "./pidApps.parse"

describe("parsePidApp", () => {
  it("accepts an app without an icon", () => {
    expect(parsePidApp({ id: "a1", label: "Notes" })).toEqual({ id: "a1", label: "Notes" })
  })

  it("accepts an app with an icon", () => {
    expect(parsePidApp({ id: "a1", label: "Notes", icon: "📝" })).toEqual({
      id: "a1",
      label: "Notes",
      icon: "📝",
    })
  })

  it("rejects a non-object, a missing field, or a wrong-typed icon", () => {
    expect(parsePidApp(null)).toBeNull()
    expect(parsePidApp({ id: "a1" })).toBeNull()
    expect(parsePidApp({ id: "a1", label: "Notes", icon: 1 })).toBeNull()
  })
})

describe("parsePidApps", () => {
  it("parses a list of valid apps", () => {
    expect(parsePidApps([{ id: "a1", label: "Notes" }])).toEqual([{ id: "a1", label: "Notes" }])
  })

  it("fails the whole list when one entry is invalid", () => {
    expect(parsePidApps([{ id: "a1", label: "Notes" }, { id: "a2" }])).toBeNull()
  })

  it("fails on a non-array", () => {
    expect(parsePidApps({})).toBeNull()
  })
})
