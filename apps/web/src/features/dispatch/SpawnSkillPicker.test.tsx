import { describe, expect, test } from "bun:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { SpawnSkillPicker } from "./SpawnSkillPicker"
import type { SpawnSkills } from "./useSpawnSkills"

const skills = (over: Partial<SpawnSkills> = {}): SpawnSkills => ({
  selected: ["goal"],
  options: ["goal", "align"],
  toggle: () => {},
  isProjectDefault: true,
  saveAsDefault: () => {},
  savePending: false,
  canManageDefault: true,
  groups: [],
  applyGroup: () => {},
  saveAsGroup: () => {},
  savingGroup: false,
  ...over,
})

const render = (over: Partial<SpawnSkills> = {}, disabled = false): string =>
  renderToStaticMarkup(createElement(SpawnSkillPicker, { skills: skills(over), disabled }))

describe("SpawnSkillPicker", () => {
  test("renders a toggle button per option, marking the selected ones", () => {
    const html = render()
    expect(html).toContain('data-skill="goal"')
    expect(html).toContain('data-skill="align"')
    // goal is selected, align is not.
    expect(html).toContain('data-skill="goal" data-selected="true"')
    expect(html).toContain('data-skill="align" data-selected="false"')
  })

  test("shows the default-management control only when a project is in scope", () => {
    expect(render({ canManageDefault: true })).toContain('data-testid="spawn-set-default"')
    expect(render({ canManageDefault: false })).not.toContain('data-testid="spawn-set-default"')
  })

  test("labels the save button by state", () => {
    expect(render({ isProjectDefault: true })).toContain("✓ Project default")
    expect(render({ isProjectDefault: false })).toContain("Set as project default")
    expect(render({ isProjectDefault: false, savePending: true })).toContain("Saving…")
  })

  test("the save button is disabled while the selection already is the default", () => {
    // isProjectDefault → disabled; not-default → enabled.
    expect(render({ isProjectDefault: false })).toContain('data-testid="spawn-set-default"')
  })

  test("renders the apply-group selector only when groups exist", () => {
    expect(render({ groups: [] })).not.toContain('data-testid="spawn-apply-group"')
    const html = render({ groups: [{ name: "TDD flow", skills: ["tdd", "ts-axioms"] }] })
    expect(html).toContain('data-testid="spawn-apply-group"')
    expect(html).toContain("TDD flow (2)")
  })

  test("always offers a save-as-group control", () => {
    const html = render()
    expect(html).toContain('data-testid="spawn-group-name"')
    expect(html).toContain('data-testid="spawn-save-group"')
  })

  test("save-as-group is disabled until a name is typed", () => {
    // No name typed (initial empty input) → disabled regardless of selection.
    expect(render({ selected: ["goal"] })).toMatch(/data-testid="spawn-save-group"[^>]*disabled/)
  })

  test("save-as-group reflects the saving state", () => {
    expect(render({ savingGroup: true })).toContain("Saving…")
  })
})
