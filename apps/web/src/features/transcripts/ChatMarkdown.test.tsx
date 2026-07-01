import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { ChatMarkdown } from "./ChatMarkdown"

const src = readFileSync(join(import.meta.dir, "ChatMarkdown.tsx"), "utf8")

const render = (text: string): string => renderToStaticMarkup(createElement(ChatMarkdown, { text }))

describe("ChatMarkdown pipeline wiring", () => {
  test("delegates to react-markdown with GFM + sanitize, like MarkdownView", () => {
    expect(src).toMatch(/from\s+["']react-markdown["']/)
    expect(src).toMatch(/remarkPlugins=\{\[remarkGfm\]\}/)
    expect(src).toMatch(/rehypePlugins=\{\[rehypeSanitize\]\}/)
  })

  test("reuses MarkdownView's component map instead of redefining it", () => {
    expect(src).toMatch(
      /import\s*\{\s*components\s*\}\s*from\s+["']\.\.\/projects\/MarkdownView["']/,
    )
    expect(src).toMatch(/components=\{components\}/)
  })

  test("exposes a stable testid for the rendered output", () => {
    expect(src).toContain('data-testid="chat-markdown"')
  })
})

describe("ChatMarkdown rendering", () => {
  test("renders headings, bold, and inline code instead of dumping literal markdown", () => {
    const html = render("## Title\n\nSome **bold** text and `inline code`.")
    expect(html).toContain("<h2")
    expect(html).toContain("<strong")
    expect(html).toContain("<code")
    expect(html).not.toContain("##")
    expect(html).not.toContain("**bold**")
  })

  test("renders GFM lists and tables", () => {
    const html = render("- one\n- two\n\n| a | b |\n| - | - |\n| 1 | 2 |")
    expect(html).toContain("<ul")
    expect(html).toContain("<table")
  })

  test("strips a javascript: link so attacker-controlled transcript text can't inject a click-through XSS", () => {
    const html = render("[click me](javascript:alert(1))")
    expect(html).not.toContain("javascript:")
  })

  test("keeps a normal https link intact", () => {
    const html = render("[docs](https://example.com/x)")
    expect(html).toContain('href="https://example.com/x"')
  })
})
