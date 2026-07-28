import { describe, expect, test } from "bun:test"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { SendKeysPanel } from "./SendKeysPanel"

const render = (short = "ab12"): string => {
  const qc = new QueryClient()
  return renderToStaticMarkup(
    createElement(QueryClientProvider, { client: qc }, createElement(SendKeysPanel, { short })),
  )
}

describe("SendKeysPanel markup", () => {
  test("keeps every legacy preset and the free-form input untouched", () => {
    const html = render()
    for (const label of ["y", "n", "1", "2", "3", "⏎", "Esc"]) {
      expect(html).toContain(`data-testid="send-preset-${label}"`)
    }
    expect(html).toContain('data-testid="send-freeform"')
  })

  test("adds a navigation row with up/down/tab/escape, each under its own send-nav-* testid", () => {
    const html = render()
    expect(html).toContain('data-testid="send-nav-up"')
    expect(html).toContain('data-testid="send-nav-down"')
    expect(html).toContain('data-testid="send-nav-tab"')
    expect(html).toContain('data-testid="send-nav-escape"')
  })

  test("the nav row lives inside the same panel as the presets (no new modal/layout shift)", () => {
    const html = render()
    const panelIdx = html.indexOf('data-testid="send-panel"')
    const navIdx = html.indexOf('data-testid="send-nav-up"')
    const freeformIdx = html.indexOf('data-testid="send-freeform"')
    expect(panelIdx).toBeGreaterThanOrEqual(0)
    // Nav row renders between the preset row and the free-form form — still
    // one flat panel, not a second surface.
    expect(navIdx).toBeGreaterThan(panelIdx)
    expect(navIdx).toBeLessThan(freeformIdx)
  })
})
