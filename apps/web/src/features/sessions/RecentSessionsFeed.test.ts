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
})
