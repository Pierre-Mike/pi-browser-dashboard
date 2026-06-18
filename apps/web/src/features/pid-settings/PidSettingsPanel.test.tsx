import { describe, expect, test } from "bun:test"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { PidSettingsPanel } from "./PidSettingsPanel"

const render = (): string => {
  const qc = new QueryClient()
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: qc },
      createElement(PidSettingsPanel, { projectId: "demo" }),
    ),
  )
}

describe("PidSettingsPanel", () => {
  // Exercises the live form hook (query wiring) end to end; before any fetch
  // resolves it renders the panel shell in its loading state.
  test("mounts and renders the settings panel shell", () => {
    const html = render()
    expect(html).toContain('data-testid="pid-settings-panel"')
    expect(html).toContain(".pid/settings.json")
  })
})
