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

  it("defaults to the Activity (sessions) tab, not the terminal", () => {
    expect(src).toMatch(/tab\s*=\s*"sessions"\s*\}\s*=\s*route\.useSearch\(\)/)
    expect(src).not.toMatch(/tab\s*=\s*"terminal"\s*\}\s*=\s*route\.useSearch\(\)/)
  })

  it("does NOT host the Orchestration tab — the supervisor is global, surfaced on the root dashboard, not per-project", () => {
    expect(src).not.toContain("OrchestrationPanel")
    expect(src).not.toMatch(/key:\s*"orchestration"/)
  })
})

describe("ProjectDashboard extension panel scoping", () => {
  it("shows a local extension's project panel only on its owning project, not every project", () => {
    // The extPanels filter must gate local-scope panels by project path:
    // a local ext (e.g. test-extension) appears only on project.path === e.projectPath.
    // Global extensions still show everywhere.
    expect(src).toMatch(/e\.scope\s*!==\s*["']local["']/)
    expect(src).toMatch(/e\.projectPath\s*===\s*project\.path/)
  })
})

describe("ProjectDashboard git pull button", () => {
  it("hosts the pull button in the header, wired to the pull mutation", () => {
    expect(src).toContain('data-testid="gh-pull"')
    expect(src).toContain("useProjectGitPull")
  })

  it("disables the button while a pull is in flight", () => {
    expect(src).toMatch(/disabled=\{[^}]*isPending/)
  })

  it("places the pull button alongside the top GitHub link", () => {
    // The Pull button is rendered in the header h1, right after the GitHub link.
    const header = src.match(/<h1[\s\S]+?<\/h1>/)
    expect(header).not.toBeNull()
    expect(header![0]).toContain('data-testid="github-link"')
    expect(header![0]).toContain("<GitPullButton")
    // and it only appears when the project has a GitHub URL
    expect(header![0]).toMatch(/project\.githubUrl \? <GitPullButton/)
  })
})

describe("ProjectDashboard fillViewport", () => {
  it("extension tabs trigger fill-viewport so the iframe stretches to full height without scrollbars", () => {
    // fillViewport must be true for any ext:* tab, not just the static viewport tabs.
    // The condition must include a check for ext: tabs.
    // Match the entire fillViewport assignment (may span multiple lines until the blank line).
    const fillViewportBlock = src.match(/const fillViewport[\s\S]+?(?=\n\n)/)
    expect(fillViewportBlock).not.toBeNull()
    const condition = fillViewportBlock?.[0]
    // Must check for extension tab pattern (tab.startsWith("ext:") or similar)
    expect(condition).toMatch(/ext/)
  })

  it("extension tab panel has the same fill-height classes as terminal/files/claude/library panels", () => {
    // The ext panel div must use flex flex-col flex-1 min-h-0 when active.
    expect(src).toContain('"flex flex-col flex-1 min-h-0"')
    // Confirm it's used by the ext panel (the ext panel must be adjacent to ExtensionHost).
    const extPanelBlock = src.match(/extPanels\.map[\s\S]+?ExtensionHost/)
    expect(extPanelBlock).not.toBeNull()
    expect(extPanelBlock?.[0]).toContain("flex flex-col flex-1 min-h-0")
  })
})

describe("ProjectDashboard pid-app tabs", () => {
  it("scopes the pid-apps list to this project so app A never appears on B", () => {
    expect(src).toContain("usePidApps(project.id)")
  })

  it("collapses every pid-app into a SINGLE parent 'Specs' dock tab, not one tab per app", () => {
    // Regression: pid-apps used to spread into the top dock as `pidapp:<id>`
    // tabs, growing it unbounded. They now live under one parent section.
    expect(src).toMatch(/key:\s*"pidapps"/)
    expect(src).toMatch(/label:\s*"Specs"/)
    // The old per-app dock mapping is gone from the tabs array.
    expect(src).not.toMatch(/key:\s*`pidapp:\$\{a\.id\}`/)
  })

  it("lists each pid-app as a left-rail sub-tab that selects it via setTab", () => {
    expect(src).toContain("subTabRailClass")
    expect(src).toMatch(/data-testid=\{`pidapp-subtab-\$\{a\.id\}`\}/)
    // Selecting a sub-tab drives the shared tab search param.
    expect(src).toMatch(/onClick=\{\(\) => setTab\(`pidapp:\$\{a\.id\}`\)\}/)
  })

  it("renders each pid-app in a sandboxed PidAppHost panel (not the RPC ExtensionHost)", () => {
    const block = src.match(/pidApps\.map\(\(a\) => \{[\s\S]+?<\/div>/)
    expect(block).not.toBeNull()
    expect(block?.[0]).toContain("PidAppHost")
    expect(block?.[0]).not.toContain("ExtensionHost")
    expect(src).toContain("data-testid={`project-tab-panel-pidapp-")
  })

  it("hosts the sub-tab rail + panels under one parent tabpanel keyed 'pidapps'", () => {
    expect(src).toContain('data-testid="project-tab-panel-pidapps"')
    // The parent tab is active for its own key or any selected app.
    expect(src).toMatch(/tab\s*===\s*"pidapps"\s*\|\|\s*tab\.startsWith\("pidapp:"\)/)
  })

  it("fill-viewports the pid-apps section so the iframe stretches to full height", () => {
    const fillViewportBlock = src.match(/const fillViewport[\s\S]+?(?=\n\n)/)
    expect(fillViewportBlock?.[0]).toMatch(/pidapps/)
  })
})

describe("ProjectDashboard pid-app creation", () => {
  it("renders the new-pid-app control inside the sub-tab rail, not the top dock nav", () => {
    // The top dock nav no longer carries the create control — it moved into the
    // Specs section's left rail alongside the apps it creates.
    const navBlock = src.match(/<nav[\s\S]+?<\/nav>/)
    expect(navBlock).not.toBeNull()
    expect(navBlock?.[0]).not.toContain("<NewPidAppButton")
    expect(src).toContain("<NewPidAppButton")
  })

  it("switches to the newly created app's sub-tab via the existing setTab", () => {
    expect(src).toMatch(/onCreated=\{\(id\) => setTab\(`pidapp:\$\{id\}`\)\}/)
  })
})
