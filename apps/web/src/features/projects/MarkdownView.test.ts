import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const src = readFileSync(join(import.meta.dir, "MarkdownView.tsx"), "utf8")
const mermaidSrc = readFileSync(join(import.meta.dir, "MermaidView.tsx"), "utf8")

describe("MarkdownView mermaid rendering", () => {
  it("imports MermaidView", () => {
    expect(src).toMatch(/from\s+["']\.\/MermaidView["']/)
  })

  it("routes code blocks with lang=mermaid to MermaidView", () => {
    expect(src).toContain('block.lang.toLowerCase() === "mermaid"')
    expect(src).toMatch(/<MermaidView code=\{block\.text\}\s*\/>/)
  })

  it("still renders non-mermaid code blocks as <pre>", () => {
    expect(src).toMatch(/<pre[^>]*>[\s\S]*<code>\{block\.text\}<\/code>/)
  })
})

describe("MermaidView", () => {
  it("lazy-imports mermaid to keep the parser bundle small", () => {
    expect(mermaidSrc).toMatch(/await import\(["']mermaid["']\)/)
  })

  it("renders into a dom node via ref + innerHTML (not dangerouslySetInnerHTML on React tree)", () => {
    expect(mermaidSrc).toContain("hostRef.current.innerHTML = svg")
  })

  it("uses strict security level so user-provided diagram text cannot inject html", () => {
    expect(mermaidSrc).toMatch(/securityLevel:\s*["']strict["']/)
  })

  it("exposes a stable testid for the rendered diagram", () => {
    expect(mermaidSrc).toContain('data-testid="mermaid-diagram"')
  })

  it("surfaces render errors instead of failing silently", () => {
    expect(mermaidSrc).toContain('data-testid="mermaid-error"')
  })
})
