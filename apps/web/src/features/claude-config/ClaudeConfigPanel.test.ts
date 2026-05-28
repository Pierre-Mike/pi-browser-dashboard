import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const src = readFileSync(join(import.meta.dir, "ClaudeConfigPanel.tsx"), "utf8")

describe("ClaudeConfigPanel md rendering", () => {
  it("renders SKILL.md body via MarkdownView, not raw <pre>", () => {
    expect(src).toContain("<MarkdownView text={detailQ.data.body}")
    expect(src).not.toMatch(/<pre[^>]*>\s*\{detailQ\.data\.body\}\s*<\/pre>/)
  })

  it("renders CLAUDE.md tab via MarkdownView, not raw <pre>", () => {
    expect(src).toContain("<MarkdownView text={bundle.claudeMd}")
    expect(src).not.toMatch(/<pre[^>]*>\s*\{bundle\.claudeMd\}\s*<\/pre>/)
  })

  it("imports MarkdownView from features/projects", () => {
    expect(src).toMatch(/from\s+["']\.\.\/projects\/MarkdownView["']/)
  })
})

describe("ClaudeConfigPanel layout fills viewport", () => {
  it("root container uses flex-1 min-h-0 so the panel can absorb available height", () => {
    expect(src).toMatch(
      /data-testid=\{`claude-config-panel-\$\{bundle\.scope\}`\}[^>]*flex-1[^>]*min-h-0/,
    )
  })

  it("SkillsTab list does not hard-cap height at 60vh", () => {
    expect(src).not.toContain("max-h-[60vh]")
  })

  it("SkillsTab detail body does not hard-cap height at 55vh", () => {
    expect(src).not.toContain("max-h-[55vh]")
  })

  it("SkillsTab grid uses flex-1 min-h-0 to fill remaining vertical space", () => {
    expect(src).toMatch(/grid grid-cols-1 md:grid-cols-3[^"`]*flex-1[^"`]*min-h-0/)
  })
})
