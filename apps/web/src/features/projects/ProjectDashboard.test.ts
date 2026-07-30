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

  it("docks Activity as the FIRST tab, so the default tab is also the leftmost one", () => {
    // The dock order used to open with Terminal, putting the default (Activity)
    // second — a project you click lands on a tab that is not where the eye goes.
    const base = src.match(/const base: Tab\[\] = \[[\s\S]+?\n\s*\]/)
    expect(base).not.toBeNull()
    const keys = [...(base?.[0].matchAll(/key:\s*"([a-z]+)"/g) ?? [])].map((m) => m[1])
    expect(keys[0]).toBe("sessions")
    expect(keys[1]).toBe("terminal")
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
    // GitHub link + Pull button render together as a pair (GithubActions),
    // gated on the same project.githubUrl check, and that pair is used inside
    // the identity h1.
    const cluster = src.match(/const GithubActions[\s\S]+?\n\)/)
    expect(cluster).not.toBeNull()
    expect(cluster?.[0]).toContain('data-testid="github-link"')
    expect(cluster?.[0]).toContain("<GitPullButton")
    expect(cluster?.[0]).toMatch(/project\.githubUrl \? \(/)
    expect(src).toMatch(
      /<h1[\s\S]+?<GithubActions project=\{project\} pull=\{pull\} \/>[\s\S]+?<\/h1>/,
    )
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
    // The rail is the shared CollapsibleRail (so it can be reduced for space);
    // it still carries the pidapp-subtabs testid via its prop.
    expect(src).toContain("<CollapsibleRail")
    expect(src).toMatch(/testid="pidapp-subtabs"/)
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

describe("ProjectDashboard collapsible rails", () => {
  it("makes the Specs left rail reducible for more space", () => {
    // The rail is wrapped so it can vanish, handing its width to the spec host.
    // Drawing boards moved to the session drill-in, so this page has one rail.
    const rails = src.match(/<CollapsibleRail/g) ?? []
    expect(rails.length).toBe(1)
    expect(src).toContain('testid="pidapp-subtabs"')
  })

  it("persists the rail's collapsed state per browser via usePersistedFlag", () => {
    expect(src).toContain("usePersistedFlag")
    expect(src).toMatch(/usePersistedFlag\("pid:specs:rail-collapsed"\)/)
  })

  it("reopens a collapsed rail from a topbar chip so the panel keeps the full width", () => {
    // The rail itself renders nothing when collapsed, so the only way back is
    // this chip, and it must sit in the topbar — above the panel, not beside it.
    expect(src).toContain("collapsedRail(")
    const chipIdx = src.indexOf("<RailExpandButton")
    const topbarIdx = src.indexOf('data-testid="project-topbar"')
    const panelIdx = src.indexOf('data-testid="project-tab-panel-pidapps"')
    expect(chipIdx).toBeGreaterThan(topbarIdx)
    expect(chipIdx).toBeLessThan(panelIdx)
  })

  it("wires the chip to the rail it names so one click restores that rail", () => {
    expect(src).toMatch(/<RailExpandButton rail=\{railChip\} onToggle=\{specsRail\.toggle\} \/>/)
  })

  it("no longer docks a Brainstorm section — boards live on the session drill-in", () => {
    // A board is a canvas file in a session's worktree, so the section belongs
    // to the surface whose agent can actually write into that tree.
    expect(src).not.toContain("brainstorm")
    expect(src).not.toContain("Brainstorm")
  })
})

describe("ProjectDashboard single-line topbar", () => {
  it("collapses the back link, identity, tab dock, pills, and Spawn into one row", () => {
    // Regression: this used to be two stacked rows (a <header> then the <nav>
    // dock). They now share one flex row so the dashboard top is a single line.
    expect(src).toContain('data-testid="project-topbar"')
    expect(src).not.toContain("<header")
    const topbarIdx = src.indexOf('data-testid="project-topbar"')
    const tabsIdx = src.indexOf('data-testid="project-tabs"')
    const spawnIdx = src.indexOf('data-testid="dashboard-spawn"')
    expect(topbarIdx).toBeGreaterThan(-1)
    expect(tabsIdx).toBeGreaterThan(topbarIdx)
    expect(spawnIdx).toBeGreaterThan(tabsIdx)
  })

  it("gives the tab dock the row's remaining width so it scrolls instead of wrapping", () => {
    const navBlock = src.match(/<nav[\s\S]+?<\/nav>/)
    expect(navBlock).not.toBeNull()
    expect(navBlock?.[0]).toMatch(/flex-1/)
    expect(navBlock?.[0]).toMatch(/min-w-0/)
  })

  it("hosts the collapsed-sidebar reopen chip in the topbar it already renders", () => {
    // The chip belongs to a row that exists anyway, so the tab panels below
    // (terminal, canvas, spec host) keep the full width down the left edge.
    expect(src).toContain('from "../sessions/sidebarRail"')
    const chipIdx = src.indexOf("<NavChromeChips />")
    const topbarIdx = src.indexOf('data-testid="project-topbar"')
    const tabsIdx = src.indexOf('data-testid="project-tabs"')
    expect(chipIdx).toBeGreaterThan(topbarIdx)
    expect(chipIdx).toBeLessThan(tabsIdx)
  })

  it("drops the standalone absolute-path row — it was already shown by the sidebar", () => {
    // The path used to render as an always-visible truncated line of its own;
    // it now lives only as a tooltip on the project name.
    expect(src).not.toMatch(/>\s*\{project\.path\}\s*</)
    expect(src).toMatch(/title=\{project\.path\}/)
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
