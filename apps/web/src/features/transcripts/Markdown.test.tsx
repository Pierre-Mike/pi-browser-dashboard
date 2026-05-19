import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { Markdown } from "./Markdown"

const render = (text: string, tone?: "user" | "default"): string =>
  renderToStaticMarkup(<Markdown text={text} tone={tone} />)

describe("Markdown", () => {
  test("renders bold and italic", () => {
    const html = render("**bold** and *em*")
    expect(html).toContain("<strong")
    expect(html).toContain("bold")
    expect(html).toContain("<em")
    expect(html).toContain("em")
  })

  test("renders inline code with backticks", () => {
    const html = render("hit `Enter` to send")
    expect(html).toContain("<code")
    expect(html).toContain("Enter")
  })

  test("renders fenced code blocks inside <pre>", () => {
    const html = render("```ts\nconst x = 1\n```")
    expect(html).toContain("<pre")
    expect(html).toContain("language-ts")
    expect(html).toContain("const x = 1")
  })

  test("renders ordered and unordered lists", () => {
    const html = render("- one\n- two\n\n1. a\n2. b")
    expect(html).toContain("<ul")
    expect(html).toContain("<ol")
    expect(html).toContain("<li")
  })

  test("renders GFM tables via remark-gfm", () => {
    const html = render("| a | b |\n|---|---|\n| 1 | 2 |")
    expect(html).toContain("<table")
    expect(html).toContain("<th")
    expect(html).toContain("<td")
  })

  test("renders links as external (target=_blank, rel=noopener)", () => {
    const html = render("[home](https://example.com)")
    expect(html).toContain('href="https://example.com"')
    expect(html).toContain('target="_blank"')
    expect(html).toContain("noopener")
  })

  test("user tone styles inline code with sky background", () => {
    const html = render("`x`", "user")
    expect(html).toMatch(/bg-sky-[67]00\/40/)
  })

  test("default tone styles inline code with slate background", () => {
    const html = render("`x`")
    expect(html).toContain("bg-slate-100")
  })

  test("preserves a raw URL on its own line as a paragraph (no autolinking quirks)", () => {
    const html = render("hello world")
    expect(html).toContain("<p")
    expect(html).toContain("hello world")
  })
})
