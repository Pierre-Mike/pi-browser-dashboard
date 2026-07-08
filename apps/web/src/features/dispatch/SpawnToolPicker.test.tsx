import { describe, expect, test } from "bun:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { SpawnToolPicker } from "./SpawnToolPicker"
import { ALL_SPAWN_TOOLS, PI_SPAWN_TOOLS } from "./spawnTools"

const render = (
  over: { selected?: readonly string[]; all?: readonly string[]; disabled?: boolean } = {},
): string =>
  renderToStaticMarkup(
    createElement(SpawnToolPicker, {
      all: over.all ?? ALL_SPAWN_TOOLS,
      selected: over.selected ?? [...(over.all ?? ALL_SPAWN_TOOLS)],
      onToggle: () => {},
      disabled: over.disabled ?? false,
    }),
  )

describe("SpawnToolPicker", () => {
  test("renders a toggle button per built-in tool", () => {
    const html = render()
    expect(html).toContain('data-tool="Bash"')
    expect(html).toContain('data-tool="Read"')
    expect(ALL_SPAWN_TOOLS.every((id) => html.includes(`data-tool="${id}"`))).toBe(true)
  })

  test("marks every tool selected by default", () => {
    const html = render()
    for (const id of ALL_SPAWN_TOOLS) {
      expect(html).toContain(`data-tool="${id}" data-selected="true"`)
    }
  })

  test("marks a deselected tool as unselected", () => {
    const selected = ALL_SPAWN_TOOLS.filter((t) => t !== "Bash")
    const html = render({ selected })
    expect(html).toContain('data-tool="Bash" data-selected="false"')
    expect(html).toContain('data-tool="Read" data-selected="true"')
  })

  test("summarizes the count in the collapsed summary", () => {
    expect(render()).toContain(`all ${ALL_SPAWN_TOOLS.length} selected`)
    const selected = ALL_SPAWN_TOOLS.filter((t) => t !== "Bash")
    expect(render({ selected })).toContain(`${selected.length}/${ALL_SPAWN_TOOLS.length} selected`)
  })

  test("is collapsed by default so 40+ pills don't clutter the modal", () => {
    const html = render()
    expect(html).toContain("<details")
    expect(html).not.toContain("open=")
  })

  test("renders the pi tool set when given the pi list", () => {
    const html = render({ all: PI_SPAWN_TOOLS })
    for (const id of PI_SPAWN_TOOLS) {
      expect(html).toContain(`data-tool="${id}" data-selected="true"`)
    }
    expect(html).not.toContain('data-tool="Bash"')
    expect(html).toContain(`all ${PI_SPAWN_TOOLS.length} selected`)
  })
})
