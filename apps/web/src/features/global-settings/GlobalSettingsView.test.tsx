import { describe, expect, test } from "bun:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { THEME_FAMILIES, type ThemeSelection } from "../../lib/ui/theme.core"
import { GlobalSettingsView } from "./GlobalSettingsView"
import type { GlobalSettingsForm } from "./useGlobalSettingsForm"

const draft = {
  git: { defaultBranch: "main", remoteName: "origin" },
  library: { catalogPath: "/c.yaml", agenticRepoPath: "/agentic" },
  orchestration: {
    claudeBin: "claude",
    defaultAgent: "",
    defaultPermissionMode: "",
    defaultEffort: "",
    maxParallel: 10,
  },
  network: { projectsRoot: "/code", appPort: 8787, tunnelPort: 5173 },
  skillGroups: [],
}

const form = (over: Partial<GlobalSettingsForm> = {}): GlobalSettingsForm => ({
  loading: false,
  error: false,
  draft,
  setField: () => {},
  skillGroups: [],
  removeSkillGroup: () => {},
  dirty: false,
  saving: false,
  save: () => {},
  reset: () => {},
  ...over,
})

const theme = (over: Partial<ThemeSelection> = {}): ThemeSelection => ({
  choice: { family: "pid", mode: "system" },
  resolved: "pidlight",
  setFamily: () => {},
  setMode: () => {},
  ...over,
})

const render = (over: Partial<GlobalSettingsForm> = {}): string =>
  renderToStaticMarkup(createElement(GlobalSettingsView, { form: form(over), theme: theme() }))

const renderTheme = (over: Partial<ThemeSelection>): string =>
  renderToStaticMarkup(createElement(GlobalSettingsView, { form: form(), theme: theme(over) }))

describe("GlobalSettingsView", () => {
  test("shows the managed global file path", () => {
    expect(render()).toContain("pid-dashboard/settings.json")
  })

  test("renders an input per field, seeded from the draft", () => {
    const html = render()
    expect(html).toContain('data-testid="gs-git-defaultBranch"')
    expect(html).toContain('value="main"')
    expect(html).toContain('data-testid="gs-network-appPort"')
    expect(html).toContain('data-testid="gs-orchestration-maxParallel"')
  })

  test("loading state replaces the form", () => {
    const html = render({ loading: true })
    expect(html).toContain("Loading settings…")
    expect(html).not.toContain('data-testid="gs-git-defaultBranch"')
  })

  test("error state shows a message", () => {
    expect(render({ error: true })).toContain('data-testid="global-settings-error"')
  })

  test("save/reset disabled unless dirty", () => {
    const clean = render({ dirty: false })
    expect(clean).toContain("Saved")
    expect(clean).toMatch(/data-testid="global-settings-save"[^>]*disabled/)
    const dirty = render({ dirty: true })
    expect(dirty).toContain("Unsaved changes")
    expect(dirty).not.toMatch(/data-testid="global-settings-save"[^>]*disabled/)
  })

  test("save button reflects saving state", () => {
    expect(render({ dirty: true, saving: true })).toContain("Saving…")
  })

  test("shows an empty hint when there are no skill groups", () => {
    expect(render({ skillGroups: [] })).toContain('data-testid="gs-skill-groups-empty"')
  })

  test("lists each skill group with its skills and a delete control", () => {
    const html = render({
      skillGroups: [{ name: "TDD flow", skills: ["tdd", "ts-axioms"] }],
    })
    expect(html).not.toContain('data-testid="gs-skill-groups-empty"')
    expect(html).toContain('data-group="TDD flow"')
    expect(html).toContain("/tdd /ts-axioms")
    expect(html).toContain('data-testid="gs-skill-group-delete"')
  })

  describe("appearance", () => {
    test("renders a family select listing every catalogued family", () => {
      const html = render()
      expect(html).toContain('data-testid="gs-section-appearance"')
      expect(html).toContain('data-testid="gs-appearance-family"')
      for (const family of THEME_FAMILIES) {
        expect(html).toContain(`value="${family.id}"`)
        expect(html).toContain(family.label)
      }
    })

    test("renders a mode select with system / light / dark", () => {
      const html = render()
      expect(html).toContain('data-testid="gs-appearance-mode"')
      expect(html).toContain('value="system"')
      expect(html).toContain('value="light"')
      expect(html).toContain('value="dark"')
    })

    test("both selects are seeded from the current choice", () => {
      const html = renderTheme({
        choice: { family: "terminal", mode: "dark" },
        resolved: "terminaldark",
      })
      expect(html).toContain('<option value="terminal" selected="">')
      expect(html).toContain('<option value="dark" selected="">')
      expect(html).not.toContain('<option value="pid" selected="">')
    })

    test("says the choice is per-browser and names the active theme", () => {
      const html = renderTheme({ resolved: "sunsetdark" })
      expect(html).toContain('data-testid="gs-appearance-hint"')
      expect(html).toContain("this browser")
      expect(html).toContain("sunsetdark")
    })

    test("appearance survives a settings load failure — it is not part of the file", () => {
      const html = render({ error: true })
      expect(html).toContain('data-testid="global-settings-error"')
      expect(html).toContain('data-testid="gs-appearance-family"')
    })
  })
})
