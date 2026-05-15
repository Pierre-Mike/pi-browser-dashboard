import { describe, expect, it } from "bun:test"
import type { Project } from "../../lib/types"
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
    const h = installPalette({ onSelectProject: () => {} })
    h.tap(0)
    expect(h.isOpen()).toBe(false)
    h.tap(DOUBLE_SHIFT_WINDOW_MS)
    expect(h.isOpen()).toBe(true)
  })

  it("ignores a second tap outside the window", () => {
    const h = installPalette({ onSelectProject: () => {} })
    h.tap(0)
    h.tap(DOUBLE_SHIFT_WINDOW_MS + 1)
    expect(h.isOpen()).toBe(false)
  })

  it("resets the pending tap when a non-shift key intervenes", () => {
    const h = installPalette({ onSelectProject: () => {} })
    h.tap(0)
    h.nonShiftKey()
    h.tap(50)
    expect(h.isOpen()).toBe(false)
  })

  it("ignores taps with modifier keys held", () => {
    const h = installPalette({ onSelectProject: () => {} })
    h.tap(0, { metaKey: true })
    h.tap(50, { metaKey: true })
    expect(h.isOpen()).toBe(false)
  })

  it("toggles closed on a second double-tap", () => {
    const h = installPalette({ onSelectProject: () => {} })
    h.tap(0)
    h.tap(100)
    expect(h.isOpen()).toBe(true)
    h.tap(500)
    h.tap(600)
    expect(h.isOpen()).toBe(false)
  })

  it("escapes close when open", () => {
    const h = installPalette({ onSelectProject: () => {} })
    h.tap(0)
    h.tap(100)
    h.esc()
    expect(h.isOpen()).toBe(false)
  })

  it("sorts entries alphabetically and filters by substring", () => {
    const h = installPalette({ onSelectProject: () => {} })
    h.setProjects([project("a", "zeta"), project("b", "alpha"), project("c", "beta")])
    expect(h.getEntries("").map((e) => e.label)).toEqual(["alpha", "beta", "zeta"])
    expect(h.getEntries("eta").map((e) => e.label)).toEqual(["beta", "zeta"])
  })

  it("selectRowAt fires onSelectProject with the filtered row's project and closes", () => {
    const selected: Project[] = []
    const h = installPalette({ onSelectProject: (p) => selected.push(p) })
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
    const h = installPalette({ onSelectProject: (p) => selected.push(p) })
    h.setProjects([project("a", "alpha")])
    h.getEntries("")
    h.selectRowAt(5)
    expect(selected).toEqual([])
  })
})
