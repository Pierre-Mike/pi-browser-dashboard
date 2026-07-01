import { describe, expect, it } from "bun:test"
import { ALL_SPAWN_TOOLS, toggleTool, toolsForDispatch } from "./spawnTools"

describe("ALL_SPAWN_TOOLS", () => {
  it("has no duplicate tool names", () => {
    expect(new Set(ALL_SPAWN_TOOLS).size).toBe(ALL_SPAWN_TOOLS.length)
  })

  it("includes the core built-in tools", () => {
    expect(ALL_SPAWN_TOOLS).toContain("Bash")
    expect(ALL_SPAWN_TOOLS).toContain("Read")
    expect(ALL_SPAWN_TOOLS).toContain("Edit")
    expect(ALL_SPAWN_TOOLS).toContain("Write")
  })
})

describe("toggleTool", () => {
  it("removes a tool that is currently selected", () => {
    const selected = [...ALL_SPAWN_TOOLS]
    const next = toggleTool(selected, "Bash")
    expect(next).not.toContain("Bash")
    expect(next.length).toBe(ALL_SPAWN_TOOLS.length - 1)
  })

  it("adds a tool that is currently unselected", () => {
    const selected = ALL_SPAWN_TOOLS.filter((t) => t !== "Bash")
    const next = toggleTool(selected, "Bash")
    expect(next).toContain("Bash")
    expect(next.length).toBe(ALL_SPAWN_TOOLS.length)
  })

  it("re-sorts to canonical order regardless of insertion order", () => {
    const selected = toggleTool(toggleTool([], "Write"), "Bash")
    expect(selected).toEqual(ALL_SPAWN_TOOLS.filter((t) => t === "Write" || t === "Bash"))
  })

  it("toggling a tool twice is a no-op", () => {
    const selected = [...ALL_SPAWN_TOOLS]
    expect(toggleTool(toggleTool(selected, "Read"), "Read")).toEqual([...ALL_SPAWN_TOOLS])
  })
})

describe("toolsForDispatch", () => {
  it("returns undefined when every tool is selected (the CLI default)", () => {
    expect(toolsForDispatch([...ALL_SPAWN_TOOLS])).toBeUndefined()
  })

  it("returns the explicit list when a tool has been deselected", () => {
    const selected = ALL_SPAWN_TOOLS.filter((t) => t !== "Bash")
    expect(toolsForDispatch(selected)).toEqual(selected)
  })

  it("returns an explicit empty list when every tool has been deselected", () => {
    expect(toolsForDispatch([])).toEqual([])
  })
})
