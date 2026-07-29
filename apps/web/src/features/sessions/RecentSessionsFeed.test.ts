import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import type { SessionState } from "../../lib/types"
import { RecentSessionsFeed } from "./RecentSessionsFeed"

const src = readFileSync(join(import.meta.dir, "RecentSessionsFeed.tsx"), "utf8")

const session: SessionState = {
  short: "abc123",
  state: "idle",
  detail: "",
  tempo: "steady",
  intent: "",
  name: "a-session",
  sessionId: "session-abc123",
  cwd: "/repo/worktree",
  createdAt: "2026-07-29T10:00:00Z",
  updatedAt: "2026-07-29T10:01:00Z",
  linkScanPath: "/repo/worktree",
}

describe("RecentSessionsFeed", () => {
  it("renders newest-first SessionCard rows from recentSessions", () => {
    expect(src).toContain("recentSessions")
    expect(src).toContain("SessionCard")
    expect(src).toContain('data-testid="recent-sessions-feed"')
    expect(src).toContain('data-testid="recent-session-row"')
  })

  it("accepts an optional showProjectName prop, defaulting to true", () => {
    expect(src).toMatch(/showProjectName\?:\s*boolean/)
    expect(src).toMatch(/showProjectName\s*=\s*true/)
  })

  it("gates the per-row project-name label on showProjectName so single-project views can drop it", () => {
    // The projectName label must be conditional, not unconditionally rendered.
    expect(src).toMatch(/showProjectName\s*\?[\s\S]*projectName/)
  })

  it("puts the project name in a fixed-width left column instead of a small line above the card", () => {
    const row = src.slice(src.indexOf("key={session.short}"))
    // The feed is wide; the label rides beside the card, not stacked over it.
    expect(row).toMatch(/className="flex items-start gap-3"/)
    // Left column: fixed width, never shrinks, clips long project names.
    expect(row).toMatch(/w-\S+\s+shrink-0[^"]*truncate/)
    // The card claims the remaining width.
    expect(row).toMatch(/min-w-0 flex-1/)
    // 11px muted text was the reason nobody saw which project a row belonged to.
    expect(row).not.toContain("text-[11px]")
  })

  // The daemon keys /terminal/states by `<scope>:<id>`, and a session's polled
  // record uses its short as the id. Getting that key wrong is silent — the chip
  // simply never appears — so assert it through a real render rather than by
  // reading the source.
  it("hands each card the terminal record keyed session:<short>", () => {
    const html = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(RecentSessionsFeed, {
          projects: [],
          sessions: [session],
          terminalStates: {
            "session:abc123": {
              scope: "session",
              id: "abc123",
              state: "working",
              matcher: "thinking-gerund",
              at: "2026-07-29T10:02:00Z",
            },
          },
        }),
      ),
    )
    expect(html).toContain('data-testid="session-card-terminal-state"')
    expect(html).toContain('data-terminal-state="working"')
  })

  it("renders without a terminal-state map at all", () => {
    const html = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(RecentSessionsFeed, { projects: [], sessions: [session] }),
      ),
    )
    expect(html).toContain('data-testid="session-card"')
    expect(html).not.toContain('data-testid="session-card-terminal-state"')
  })

  it("keeps the live-feed caption but as a compact inline label, not its own decorated row", () => {
    // recent-activity.spec.ts asserts /most recent/i is still present.
    expect(src).toMatch(/most recent/)
    // The pulsing dot duplicated the state colour already on every
    // SessionCard — dropping it shrinks the caption's footprint.
    expect(src).not.toContain("animate-pulse")
  })
})
