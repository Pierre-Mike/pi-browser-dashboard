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

  it("does NOT host the Orchestration tab — the supervisor is global, surfaced on the root dashboard, not per-project", () => {
    expect(src).not.toContain("OrchestrationPanel")
    expect(src).not.toMatch(/key:\s*"orchestration"/)
  })
})

describe("ProjectDashboard fillViewport", () => {
  it("extension tabs trigger fill-viewport so the iframe stretches to full height without scrollbars", () => {
    // fillViewport must be true for any ext:* tab, not just the static viewport tabs.
    // The condition must include a check for ext: tabs.
    // Match the entire fillViewport assignment (may span multiple lines until the blank line).
    const fillViewportBlock = src.match(/const fillViewport[\s\S]+?(?=\n\n)/)
    expect(fillViewportBlock).not.toBeNull()
    const condition = fillViewportBlock![0]
    // Must check for extension tab pattern (tab.startsWith("ext:") or similar)
    expect(condition).toMatch(/ext/)
  })

  it("extension tab panel has the same fill-height classes as terminal/files/claude/library panels", () => {
    // The ext panel div must use flex flex-col flex-1 min-h-0 when active.
    expect(src).toContain('"flex flex-col flex-1 min-h-0"')
    // Confirm it's used by the ext panel (the ext panel must be adjacent to ExtensionHost).
    const extPanelBlock = src.match(/extPanels\.map[\s\S]+?ExtensionHost/)
    expect(extPanelBlock).not.toBeNull()
    expect(extPanelBlock![0]).toContain("flex flex-col flex-1 min-h-0")
  })
})
