import { describe, expect, test } from "bun:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
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

const render = (over: Partial<GlobalSettingsForm> = {}): string =>
  renderToStaticMarkup(createElement(GlobalSettingsView, { form: form(over) }))

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
})
