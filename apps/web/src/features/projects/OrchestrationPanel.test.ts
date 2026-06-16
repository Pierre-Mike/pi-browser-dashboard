import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const src = readFileSync(join(import.meta.dir, "OrchestrationPanel.tsx"), "utf8")

describe("OrchestrationPanel", () => {
  it("attaches a terminal to the shared orchestrator session (kind='orchestrator'), not a per-project one", () => {
    expect(src).toMatch(/from\s+["']\.\.\/terminal\/TerminalView["']/)
    expect(src).toContain('kind="orchestrator"')
    // The orchestrator is a single global supervisor — it must NOT be scoped to
    // the project path, or every project page would spawn a rival session and
    // the voice-event hook (which targets one `Orchestrator`) would fan out.
    expect(src).not.toContain('kind="project"')
    expect(src).not.toContain("projectPath")
  })

  it("does not pass an id — the orchestrator route has no id segment", () => {
    expect(src).not.toMatch(/\bid=\{/)
  })
})
