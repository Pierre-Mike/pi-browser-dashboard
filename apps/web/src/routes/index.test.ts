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
    expect(src).toContain("className={tabDockNavClass}")
    const usages = src.match(/className=\{tabButtonClass\(active\)\}/g) ?? []
    expect(usages.length).toBe(2)
  })
})
