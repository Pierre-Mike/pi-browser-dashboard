import { describe, expect, test } from "bun:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { THEME_FAMILIES, type ThemeSelection } from "../../lib/ui/theme.core"
import type { SaveMachineDefault } from "./AppearanceFieldset"
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
  ui: { themeFamily: "", themeMode: "" },
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
  machine: {},
  setFamily: () => {},
  setMode: () => {},
  ...over,
})

const saveDefault = (over: Partial<SaveMachineDefault> = {}): SaveMachineDefault => ({
  saving: false,
  failed: false,
  run: () => {},
  ...over,
})

const render = (over: Partial<GlobalSettingsForm> = {}): string =>
  renderToStaticMarkup(
    createElement(GlobalSettingsView, {
      form: form(over),
      theme: theme(),
      saveDefault: saveDefault(),
    }),
  )

const renderTheme = (over: Partial<ThemeSelection>): string =>
  renderToStaticMarkup(
    createElement(GlobalSettingsView, {
      form: form(),
      theme: theme(over),
      saveDefault: saveDefault(),
    }),
  )

const renderSaveDefault = (
  over: Partial<SaveMachineDefault>,
  themeOver: Partial<ThemeSelection> = {},
): string =>
  renderToStaticMarkup(
    createElement(GlobalSettingsView, {
      form: form(),
      theme: theme(themeOver),
      saveDefault: saveDefault(over),
    }),
  )

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

    // The hint has to describe *both* halves now, or it lies: the selects are
    // still this browser's, but what they do is override a machine-wide default
    // that a different browser would follow.
    test("says the choice is this browser's, overriding the machine default", () => {
      const html = renderTheme({ resolved: "sunsetdark" })
      expect(html).toContain('data-testid="gs-appearance-hint"')
      expect(html).toContain("this browser")
      expect(html).toContain("machine")
      expect(html).toContain("sunsetdark")
    })

    test("names the stored machine default, and says so when there is none", () => {
      expect(renderTheme({ machine: { family: "terminal", mode: "dark" } })).toContain("Terminal")
      expect(renderTheme({ machine: {} })).toContain("not set")
    })

    test("offers to store the current choice as the machine default", () => {
      expect(render()).toContain('data-testid="gs-appearance-set-default"')
      expect(renderSaveDefault({ saving: true })).toContain("Saving…")
    })

    // Setting it again would post a write that changes nothing.
    test("the control is disabled once the machine default already matches", () => {
      const matching = renderSaveDefault({}, { machine: { family: "pid", mode: "system" } })
      expect(matching).toMatch(/data-testid="gs-appearance-set-default"[^>]*disabled/)
      const differing = renderSaveDefault({}, { machine: { family: "mono", mode: "dark" } })
      expect(differing).not.toMatch(/data-testid="gs-appearance-set-default"[^>]*disabled/)
    })

    test("a failed machine-default write is reported next to its own button", () => {
      expect(renderSaveDefault({ failed: true })).toContain(
        'data-testid="gs-appearance-save-error"',
      )
    })

    // The reason Appearance sits outside `form` and outside its error branch: a
    // daemon that is down must not also cost you the ability to switch to a
    // readable theme. Only the machine-default half needs the round-trip.
    test("appearance survives a settings load failure — the picker is not part of the file", () => {
      const html = render({ error: true })
      expect(html).toContain('data-testid="global-settings-error"')
      expect(html).toContain('data-testid="gs-appearance-family"')
      expect(html).toContain('data-testid="gs-appearance-mode"')
      expect(html).toContain('data-testid="gs-appearance-set-default"')
    })
  })
})
