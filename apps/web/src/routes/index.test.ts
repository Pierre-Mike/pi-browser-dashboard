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
