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
