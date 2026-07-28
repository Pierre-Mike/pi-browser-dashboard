import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const src = readFileSync(join(import.meta.dir, "RecentSessionsFeed.tsx"), "utf8")

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

  it("keeps the live-feed caption but as a compact inline label, not its own decorated row", () => {
    // recent-activity.spec.ts asserts /most recent/i is still present.
    expect(src).toMatch(/most recent/)
    // The pulsing dot duplicated the state colour already on every
    // SessionCard — dropping it shrinks the caption's footprint.
    expect(src).not.toContain("animate-pulse")
  })
})
