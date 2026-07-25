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

  it("keeps the live-feed caption but as a compact inline label, not its own decorated row", () => {
    // recent-activity.spec.ts asserts /most recent/i is still present.
    expect(src).toMatch(/most recent/)
    // The pulsing dot duplicated the state colour already on every
    // SessionCard — dropping it shrinks the caption's footprint.
    expect(src).not.toContain("animate-pulse")
  })
})
