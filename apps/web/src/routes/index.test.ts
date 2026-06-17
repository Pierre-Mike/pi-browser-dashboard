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

describe("root dashboard navigation polish (daisyUI dock)", () => {
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
      expect(src).toMatch(new RegExp(`${key}:\\s*[(<]`))
    }
  })

  it("gives extension tabs an icon too", () => {
    expect(src).toMatch(/const EXT_ICON\s*=/)
    expect(src).toContain("{EXT_ICON}")
  })

  it("styles the active tab as a daisyUI primary fill via a shared tabClass helper", () => {
    expect(src).toMatch(/const tabClass\s*=\s*\(active: boolean\)/)
    expect(src).toContain("bg-primary text-primary-content")
    // Both tab loops share the helper instead of inlining border styles.
    const usages = src.match(/className=\{tabClass\(active\)\}/g) ?? []
    expect(usages.length).toBe(2)
  })

  it("frames the tabs as a rounded dock rather than a bottom-border strip", () => {
    expect(src).toMatch(/data-testid="dashboard-tabs"[\s\S]*?rounded-xl/)
  })
})
