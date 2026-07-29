import { describe, expect, test } from "bun:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { TerminalStateChip } from "./TerminalStateChip"
import type { TerminalStateEvent } from "./terminalState"

const render = (event: TerminalStateEvent | undefined): string =>
  renderToStaticMarkup(createElement(TerminalStateChip, { event }))

describe("TerminalStateChip", () => {
  test("renders nothing before the daemon has classified this terminal", () => {
    expect(render(undefined)).toBe("")
  })

  test("shows the working tone and label, with matcher/evidence as the title", () => {
    const html = render({
      scope: "session",
      id: "abc123",
      state: "working",
      matcher: "thinking-gerund",
      evidence: "Burrowing…(3s · ↓4 tokens)",
      screenReadAt: "2026-07-28T00:00:00.000Z",
      stateChangedAt: "2026-07-28T00:00:00.000Z",
    })
    expect(html).toContain('data-testid="terminal-state-chip"')
    expect(html).toContain("Working")
    expect(html).toContain("bg-info/15")
    expect(html).toContain('title="thinking-gerund: Burrowing…(3s · ↓4 tokens)"')
  })

  test("shows the blocked tone for a permission prompt", () => {
    const html = render({
      scope: "project",
      id: "pi-browser-dashboard",
      state: "blocked",
      matcher: "permission-prompt",
      screenReadAt: "2026-07-28T00:00:00.000Z",
      stateChangedAt: "2026-07-28T00:00:00.000Z",
    })
    expect(html).toContain("Blocked")
    expect(html).toContain("bg-warning/15")
  })

  test("renders unknown honestly rather than defaulting to idle", () => {
    const html = render({
      scope: "global",
      id: "global",
      state: "unknown",
      screenReadAt: "2026-07-28T00:00:00.000Z",
      stateChangedAt: "2026-07-28T00:00:00.000Z",
    })
    expect(html).toContain("Unknown")
    expect(html).toContain('title="unknown — no matcher has fired yet"')
  })
})
