import { describe, expect, it } from "bun:test"
import type { Project } from "../../lib/types"
import { THEME_PALETTE_ACTIONS } from "../../lib/ui/theme.core"
import { DOUBLE_SHIFT_WINDOW_MS, installPalette } from "./palette"

const project = (id: string, name: string): Project => ({
  id,
  name,
  path: `/p/${id}`,
  isGitRepo: true,
  lastModified: 0,
})

describe("palette state machine", () => {
  it("opens on two shift taps inside the window", () => {
    const h = installPalette({ onSelectProject: () => {}, onRunAction: () => {} })
    h.tap(0)
    expect(h.isOpen()).toBe(false)
    h.tap(DOUBLE_SHIFT_WINDOW_MS)
    expect(h.isOpen()).toBe(true)
  })

  it("ignores a second tap outside the window", () => {
    const h = installPalette({ onSelectProject: () => {}, onRunAction: () => {} })
    h.tap(0)
    h.tap(DOUBLE_SHIFT_WINDOW_MS + 1)
    expect(h.isOpen()).toBe(false)
  })

  it("resets the pending tap when a non-shift key intervenes", () => {
    const h = installPalette({ onSelectProject: () => {}, onRunAction: () => {} })
    h.tap(0)
    h.nonShiftKey()
    h.tap(50)
    expect(h.isOpen()).toBe(false)
  })

  it("ignores taps with modifier keys held", () => {
    const h = installPalette({ onSelectProject: () => {}, onRunAction: () => {} })
    h.tap(0, { metaKey: true })
    h.tap(50, { metaKey: true })
    expect(h.isOpen()).toBe(false)
  })

  it("toggles closed on a second double-tap", () => {
    const h = installPalette({ onSelectProject: () => {}, onRunAction: () => {} })
    h.tap(0)
    h.tap(100)
    expect(h.isOpen()).toBe(true)
    h.tap(500)
    h.tap(600)
    expect(h.isOpen()).toBe(false)
  })

  it("escapes close when open", () => {
    const h = installPalette({ onSelectProject: () => {}, onRunAction: () => {} })
    h.tap(0)
    h.tap(100)
    h.esc()
    expect(h.isOpen()).toBe(false)
  })

  it("sorts projects alphabetically and filters by substring", () => {
    const h = installPalette({ onSelectProject: () => {}, onRunAction: () => {} })
    h.setProjects([project("a", "zeta"), project("b", "alpha"), project("c", "beta")])
    const projectLabels = (query: string) =>
      h
        .getEntries(query)
        .filter((e) => e.kind === "project")
        .map((e) => e.label)
    expect(projectLabels("")).toEqual(["alpha", "beta", "zeta"])
    expect(projectLabels("eta")).toEqual(["beta", "zeta"])
  })

  it("selectRowAt fires onSelectProject with the filtered row's project and closes", () => {
    const selected: Project[] = []
    const h = installPalette({ onSelectProject: (p) => selected.push(p), onRunAction: () => {} })
    h.setProjects([project("a", "zeta"), project("b", "alpha"), project("c", "beta")])
    h.tap(0)
    h.tap(100)
    h.getEntries("eta")
    h.selectRowAt(1)
    expect(selected.map((p) => p.id)).toEqual(["a"])
    expect(h.isOpen()).toBe(false)
  })

  it("selectRowAt is a no-op when the index is out of range", () => {
    const selected: Project[] = []
    const h = installPalette({ onSelectProject: (p) => selected.push(p), onRunAction: () => {} })
    h.setProjects([project("a", "alpha")])
    h.getEntries("")
    h.selectRowAt(99)
    expect(selected).toEqual([])
  })
})

// Commands are the palette's second kind of row. Registration lives here; what
// each command *means* lives in lib/ui/theme.core.ts, which has its own tests.
describe("palette commands", () => {
  const install = () => {
    const ran: string[] = []
    const selected: Project[] = []
    const h = installPalette({
      onSelectProject: (p) => selected.push(p),
      onRunAction: (id) => ran.push(id),
    })
    return { h, ran, selected }
  }

  it("registers every theme command, with no projects loaded at all", () => {
    const { h } = install()
    const actions = h.getEntries("").filter((e) => e.kind === "action")
    expect(actions.map((e) => e.id)).toEqual(THEME_PALETTE_ACTIONS.map((a) => a.id))
  })

  it("finds the whole group by typing 'theme'", () => {
    const { h } = install()
    h.setProjects([project("a", "alpha")])
    const found = h.getEntries("theme")
    expect(found).toHaveLength(THEME_PALETTE_ACTIONS.length)
    expect(found.every((e) => e.kind === "action")).toBe(true)
  })

  it("sorts commands after the projects", () => {
    const { h } = install()
    h.setProjects([project("z", "zeta")])
    expect(h.getEntries("").map((e) => e.kind)).toEqual([
      "project",
      ...THEME_PALETTE_ACTIONS.map(() => "action" as const),
    ])
  })

  it("selecting a command runs it by id, and closes", () => {
    const { h, ran, selected } = install()
    h.setProjects([project("a", "alpha")])
    h.tap(0)
    h.tap(100)
    const rows = h.getEntries("theme")
    h.selectRowAt(rows.findIndex((e) => e.id === "theme:mode:dark"))
    expect(ran).toEqual(["theme:mode:dark"])
    expect(selected).toEqual([])
    expect(h.isOpen()).toBe(false)
  })

  it("keeps the commands after dispose, since they are not loaded data", () => {
    const { h } = install()
    h.setProjects([project("a", "alpha")])
    h.dispose()
    expect(h.getEntries("").map((e) => e.id)).toEqual(THEME_PALETTE_ACTIONS.map((a) => a.id))
  })
})
