import { describe, expect, test } from "bun:test"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import type { SessionState } from "../../lib/types"
import type { TerminalStateEvent } from "../terminal/terminalState"
import { SessionCard } from "./SessionCard"

const sampleSession: SessionState = {
  short: "abc123",
  state: "working",
  detail: "doing a thing",
  tempo: "steady",
  intent: "fix the bug",
  name: "fix-the-bug",
  sessionId: "session-abc123",
  cwd: "/repo/worktree",
  createdAt: "2026-06-13T10:00:00Z",
  updatedAt: "2026-06-13T10:01:00Z",
  linkScanPath: "/repo/worktree",
}

const renderCardWith = (input: {
  readonly session: SessionState
  readonly terminal?: TerminalStateEvent
}): string => {
  const qc = new QueryClient()
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: qc },
      createElement(SessionCard, { session: input.session, terminal: input.terminal }),
    ),
  )
}

const renderCard = (session: SessionState): string => renderCardWith({ session })

// Counts the deepest run of currently-open <button> tags. >1 means a <button>
// is nested inside another <button> — invalid HTML that React rejects with
// validateDOMNesting and that breaks click target / keyboard / AT semantics.
const maxButtonNestingDepth = (html: string): number => {
  let depth = 0
  let max = 0
  const tagRe = /<(\/?)button\b[^>]*>/g
  let m: RegExpExecArray | null = tagRe.exec(html)
  while (m !== null) {
    if (m[1] === "/") depth -= 1
    else {
      depth += 1
      if (depth > max) max = depth
    }
    m = tagRe.exec(html)
  }
  return max
}

// Grabs the opening tag (attributes included) of the first element carrying
// the given data-testid, so a test can assert on its class list without
// caring about the rest of the markup.
const openTag = (html: string, testid: string): string => {
  const idx = html.indexOf(`data-testid="${testid}"`)
  if (idx === -1) throw new Error(`data-testid="${testid}" not found`)
  const start = html.lastIndexOf("<", idx)
  const end = html.indexOf(">", idx)
  return html.slice(start, end + 1)
}

// The meta row has no nested <div>s (only <span>s), so the next "</div>"
// after its opening tag is its own close — safe to slice out its contents.
const metaRowHtml = (html: string): string => {
  const idx = html.indexOf('data-testid="session-card-meta"')
  if (idx === -1) throw new Error('data-testid="session-card-meta" not found')
  const start = html.lastIndexOf("<div", idx)
  const end = html.indexOf("</div>", idx)
  return html.slice(start, end)
}

describe("SessionCard markup", () => {
  test("never nests a <button> inside another <button>", () => {
    expect(maxButtonNestingDepth(renderCard(sampleSession))).toBeLessThanOrEqual(1)
  })

  test("still renders the open surface and every action control", () => {
    const html = renderCard(sampleSession)
    expect(html).toContain('data-testid="session-card"')
    expect(html).toContain('data-testid="session-card-name"')
    expect(html).toContain('data-testid="peek"')
    expect(html).toContain('data-testid="send-toggle"')
    expect(html).toContain('data-testid="stop"')
    expect(html).toContain('data-testid="delete"')
  })

  // The unattended poller classifies the zellij screen of a session nobody has
  // opened, which is only worth pixels on a card when it contradicts the
  // supervisor's own badge — see terminalStateAddsInfo.
  test("shows a terminal chip when the screen disagrees with the supervisor", () => {
    const html = renderCardWith({
      session: { ...sampleSession, state: "idle" },
      terminal: {
        scope: "session",
        id: sampleSession.short,
        state: "working",
        matcher: "thinking-gerund",
        evidence: "Burrowing…",
        at: "2026-07-29T00:00:00.000Z",
      },
    })
    expect(html).toContain('data-testid="session-card-terminal-state"')
    // The tooltip names the screen as the source and carries the matcher, so a
    // human can tell which of the two chips came from where.
    expect(html).toContain("terminal: thinking-gerund: Burrowing…")
  })

  test("stays silent when the screen agrees, or has never been classified", () => {
    const agreeing = renderCardWith({
      session: sampleSession,
      terminal: {
        scope: "session",
        id: sampleSession.short,
        state: "working",
        matcher: "pi-working",
        at: "2026-07-29T00:00:00.000Z",
      },
    })
    expect(agreeing).not.toContain('data-testid="session-card-terminal-state"')
    expect(renderCard(sampleSession)).not.toContain('data-testid="session-card-terminal-state"')
  })

  test("merges the detail and cwd · age lines onto one row", () => {
    const row = metaRowHtml(renderCard(sampleSession))
    expect(row).toContain("doing a thing")
    expect(row).toContain("repo/worktree")
  })

  test("the card surface carries `group` so the action row can react to hover/focus-within", () => {
    const tag = openTag(renderCard(sampleSession), "session-card")
    expect(tag).toContain("group")
  })

  test("the action row is always visible below md, revealed by hover/focus at md and up", () => {
    const html = renderCard(sampleSession)
    // Base (mobile/touch, no hover) stays visible; only md: and up hides it
    // by default and brings it back on hover or keyboard focus.
    expect(html).toContain("md:opacity-0")
    expect(html).toContain("md:group-hover:opacity-100")
    expect(html).toContain("md:group-focus-within:opacity-100")
  })

  test("a needs_input session opens the SendKeys panel by default", () => {
    expect(renderCard(sampleSession)).not.toContain('data-testid="send-panel"')
    const blocked = renderCard({ ...sampleSession, state: "needs_input" })
    expect(blocked).toContain('data-testid="send-panel"')
    // The SendKeys textarea is a sibling of the open surface, never nested in a button.
    expect(maxButtonNestingDepth(blocked)).toBeLessThanOrEqual(1)
  })

  test("the opened SendKeys panel includes the named-vocabulary nav row", () => {
    const blocked = renderCard({ ...sampleSession, state: "needs_input" })
    expect(blocked).toContain('data-testid="send-nav-up"')
    expect(blocked).toContain('data-testid="send-nav-down"')
    expect(blocked).toContain('data-testid="send-nav-tab"')
    expect(blocked).toContain('data-testid="send-nav-escape"')
  })
})

describe("SessionCard (pi harness)", () => {
  const piSession: SessionState = {
    ...sampleSession,
    short: "aaaa1111",
    sessionId: "aaaa1111-2222-3333-4444-555566667777",
    harness: "pi",
  }

  test("badges the card as pi", () => {
    const html = renderCard(piSession)
    expect(html).toContain('data-testid="harness-badge"')
    expect(html).toContain(">pi<")
  })

  test("hides claude-only controls (peek/send/kill) but keeps delete", () => {
    const html = renderCard(piSession)
    expect(html).not.toContain('data-testid="peek"')
    expect(html).not.toContain('data-testid="send-toggle"')
    expect(html).not.toContain('data-testid="stop"')
    expect(html).toContain('data-testid="delete"')
  })

  test("copy control offers the pi resume command instead of claude attach", () => {
    expect(renderCard(piSession)).toContain("pi --session aaaa1111-2222-3333-4444-555566667777")
  })

  test("claude cards are unchanged: no harness badge", () => {
    expect(renderCard(sampleSession)).not.toContain('data-testid="harness-badge"')
  })
})
