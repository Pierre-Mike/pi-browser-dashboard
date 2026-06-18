import { describe, expect, test } from "bun:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { PidSettingsView } from "./PidSettingsView"
import type { PidSettingsForm } from "./usePidSettingsForm"

const form = (over: Partial<PidSettingsForm> = {}): PidSettingsForm => ({
  loading: false,
  error: false,
  options: ["goal", "align", "tdd"],
  selected: ["goal"],
  toggle: () => {},
  dirty: false,
  saving: false,
  save: () => {},
  reset: () => {},
  ...over,
})

const render = (over: Partial<PidSettingsForm> = {}): string =>
  renderToStaticMarkup(createElement(PidSettingsView, { form: form(over) }))

describe("PidSettingsView", () => {
  test("shows the managed file path", () => {
    expect(render()).toContain(".pid/settings.json")
  })

  test("renders a chip per option, marking selected ones", () => {
    const html = render({ selected: ["align"] })
    expect(html).toContain('data-skill="goal" data-selected="false"')
    expect(html).toContain('data-skill="align" data-selected="true"')
    expect(html).toContain('data-skill="tdd"')
  })

  test("loading state replaces the form", () => {
    const html = render({ loading: true })
    expect(html).toContain("Loading settings…")
    expect(html).not.toContain('data-testid="pid-settings-default-skills"')
  })

  test("error state shows a message", () => {
    expect(render({ error: true })).toContain('data-testid="pid-settings-error"')
  })

  test("save/reset enabled only when dirty", () => {
    const clean = render({ dirty: false })
    expect(clean).toContain("Saved")
    // disabled attribute present on the save button when not dirty
    expect(clean).toMatch(/data-testid="pid-settings-save"[^>]*disabled/)

    const dirty = render({ dirty: true })
    expect(dirty).toContain("Unsaved changes")
    expect(dirty).not.toMatch(/data-testid="pid-settings-save"[^>]*disabled/)
  })

  test("save button reflects the saving state", () => {
    expect(render({ dirty: true, saving: true })).toContain("Saving…")
  })
})
