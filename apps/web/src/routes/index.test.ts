import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const src = readFileSync(join(import.meta.dir, "index.tsx"), "utf8")

describe("root dashboard orchestration tab", () => {
  it("registers a global Orchestration tab wired to OrchestrationPanel", () => {
    expect(src).toContain('from "../features/projects/OrchestrationPanel"')
    expect(src).toMatch(/key:\s*"orchestration"/)
    expect(src).toContain('data-testid="dashboard-tab-panel-orchestration"')
  })

  it("treats orchestration as a viewport-filling tab and mounts the panel lazily", () => {
    expect(src).toMatch(/tab === "orchestration"/)
    // Lazy mount: only render the panel (and open its WS) when the tab is active.
    expect(src).toMatch(/tab === "orchestration"\s*\?\s*<OrchestrationPanel\s*\/>\s*:\s*null/)
  })

  it("includes orchestration in the validated static tab keys so the ?tab= deep link survives", () => {
    expect(src).toMatch(/STATIC_TAB_KEYS\s*=\s*\[[\s\S]*"orchestration"[\s\S]*\]/)
  })
})

describe("root dashboard default tab", () => {
  it("docks Activity FIRST and opens on it, matching the project dashboard", () => {
    // The dock used to open with Terminal, so landing on "/" attached a pty
    // before you had asked for one. Activity (`projects`) is the leftmost tab
    // and the fallback, so first and default agree on both dashboards.
    const tabs = src.match(/const TABS:[\s\S]+?\n\]/)
    expect(tabs).not.toBeNull()
    const keys = [...(tabs?.[0].matchAll(/key:\s*"([a-z]+)"/g) ?? [])].map((m) => m[1])
    expect(keys[0]).toBe("projects")
    expect(keys).toContain("terminal")
    expect(src).toMatch(/tab\s*=\s*"projects"\s*\}\s*=\s*Route\.useSearch\(\)/)
    expect(src).not.toMatch(/tab\s*=\s*"terminal"\s*\}\s*=\s*Route\.useSearch\(\)/)
  })
})

describe("root dashboard navigation polish (shared daisyUI dock)", () => {
  it("renders an icon next to every static tab via a keyed ICONS map", () => {
    // One icon per static tab key — the bar must read at a glance.
    expect(src).toMatch(/const ICONS:\s*Record<StaticTabKey,\s*ReactNode>/)
    expect(src).toContain("{ICONS[t.key]}")
    for (const key of [
      "terminal",
      "orchestration",
      "projects",
      "claude",
      "library",
      "extensions",
      "tunnel",
    ]) {
      expect(src).toMatch(new RegExp(`${key}:\\s*TAB_ICONS`))
    }
  })

  it("gives extension tabs the shared extension icon too", () => {
    expect(src).toContain("{EXT_ICON}")
  })

  it("uses the shared tab-dock helpers instead of inlining the styling", () => {
    // The look lives in lib/tabDock so the dashboard + project page stay identical.
    expect(src).toContain('from "../lib/tabDock"')
    // The dock shares one styling helper; it only adds the flex sizing it needs
    // to sit beside the collapsed-sidebar reopen chip.
    expect(src).toMatch(/className=\{`\$\{tabDockNavClass\} flex-1 min-w-0`\}/)
    const usages = src.match(/className=\{tabButtonClass\(active\)\}/g) ?? []
    expect(usages.length).toBe(2)
  })
})

describe("root dashboard — collapsed-sidebar reopen chip", () => {
  it("hosts the chip as the first item of the tab-dock row, not as a floating overlay", () => {
    expect(src).toContain('from "../features/sessions/sidebarRail"')
    expect(src).toMatch(/<SidebarReopenButton\s*\/>\s*<nav/)
  })
})

describe("root dashboard density", () => {
  it("tightens the vertical rhythm between the tab dock and the active panel", () => {
    expect(src).toMatch(/flex flex-col gap-2 \$\{fillViewport/)
    expect(src).not.toMatch(/flex flex-col gap-4 \$\{fillViewport/)
  })
})
