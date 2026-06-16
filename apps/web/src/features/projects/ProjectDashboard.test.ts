import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const src = readFileSync(join(import.meta.dir, "ProjectDashboard.tsx"), "utf8")

describe("ProjectDashboard activity panel", () => {
  it("renders the project's sessions as the shared activity feed, not a bespoke grid", () => {
    expect(src).toMatch(/from\s+["']\.\.\/sessions\/RecentSessionsFeed["']/)
    expect(src).toContain("RecentSessionsFeed")
    // The old multi-column session grid is gone — same row design as the home feed.
    expect(src).not.toContain("md:grid-cols-2 xl:grid-cols-3")
    // SessionCard is now owned by the feed, not rendered directly here.
    expect(src).not.toContain("import { SessionCard }")
  })

  it("drops the redundant per-row project name (every row is this project)", () => {
    expect(src).toContain("showProjectName={false}")
  })

  it("shows all of the project's sessions, uncapped by the cross-project RECENT_LIMIT", () => {
    expect(src).toMatch(/limit=\{(Number\.POSITIVE_INFINITY|Infinity)\}/)
  })

  it("labels the panel as Activity", () => {
    expect(src).toMatch(/label:\s*`?Activity/)
  })
})

describe("ProjectDashboard orchestration tab", () => {
  it("registers an Orchestration tab and renders its panel via OrchestrationPanel", () => {
    expect(src).toMatch(/key:\s*"orchestration"/)
    expect(src).toContain("OrchestrationPanel")
    expect(src).toContain('data-testid="project-tab-panel-orchestration"')
  })

  it("treats the orchestration tab as a viewport-filling tab (it hosts a terminal)", () => {
    expect(src).toMatch(/tab === "orchestration"/)
  })
})
