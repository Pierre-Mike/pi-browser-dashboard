import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const src = readFileSync(join(import.meta.dir, "MarkdownView.tsx"), "utf8")
const mermaidSrc = readFileSync(join(import.meta.dir, "MermaidView.tsx"), "utf8")

describe("MarkdownView rendering pipeline", () => {
  it("delegates parsing to react-markdown", () => {
    expect(src).toMatch(/from\s+["']react-markdown["']/)
  })

  it("enables GFM (tables, task lists, strikethrough) via remark-gfm", () => {
    expect(src).toMatch(/from\s+["']remark-gfm["']/)
    expect(src).toMatch(/remarkPlugins=\{\[remarkGfm\]\}/)
  })

  it("is safe by construction — sanitizes with rehype-sanitize so raw HTML cannot inject", () => {
    expect(src).toMatch(/from\s+["']rehype-sanitize["']/)
    expect(src).toMatch(/rehypePlugins=\{\[rehypeSanitize\]\}/)
  })

  it("exposes a stable testid for the rendered output", () => {
    expect(src).toContain('data-testid="markdown-rendered"')
  })
})

describe("MarkdownView code-block routing", () => {
  it("imports MermaidView and routes mermaid fences to it", () => {
    expect(src).toMatch(/from\s+["']\.\/MermaidView["']/)
    expect(src).toContain('lang.toLowerCase() === "mermaid"')
    expect(src).toMatch(/<MermaidView code=\{text\}\s*\/>/)
  })

  it("syntax-highlights non-mermaid fences through @pierre/diffs", () => {
    expect(src).toMatch(/from\s+["']@pierre\/diffs\/react["']/)
    expect(src).toMatch(/<PierreFile file=\{\{ name, contents: text \}\}/)
  })

  it("owns the <pre> boundary so block code is never nested inside <pre>", () => {
    expect(src).toMatch(/pre:\s*\(\{ children \}\)/)
  })

  it("honours GFM column alignment on table cells via node.properties.align", () => {
    expect(src).toMatch(/from\s+["']\.\/markdownAlign["']/)
    expect(src).toMatch(/th:\s*\(\{ node, children \}\)/)
    expect(src).toMatch(/td:\s*\(\{ node, children \}\)/)
    expect(src).toContain("alignClass(node?.properties.align)")
  })
})

describe("MermaidView", () => {
  it("lazy-imports mermaid to keep the parser bundle small", () => {
    expect(mermaidSrc).toMatch(/await import\(["']mermaid["']\)/)
  })

  it("renders into a dom node via ref + innerHTML (not dangerouslySetInnerHTML on React tree)", () => {
    expect(mermaidSrc).toMatch(/hostRef\.current\.innerHTML\s*=\s*DOMPurify\.sanitize\(/)
  })

  it("sanitizes svg output through DOMPurify before injecting into DOM", () => {
    expect(mermaidSrc).toMatch(/import DOMPurify from ["']dompurify["']/)
    expect(mermaidSrc).toMatch(/DOMPurify\.sanitize\(svg,/)
    expect(mermaidSrc).toMatch(/USE_PROFILES.*svg:\s*true/)
  })

  it("uses strict security level so user-provided diagram text cannot inject html", () => {
    expect(mermaidSrc).toMatch(/securityLevel:\s*["']strict["']/)
  })

  it("initializes mermaid at module level with a run-once guard, not inside every render effect", () => {
    expect(mermaidSrc).toMatch(/let initialized/)
    expect(mermaidSrc).toMatch(/if\s*\(!initialized\)/)
  })

  it("exposes a stable testid for the rendered diagram", () => {
    expect(mermaidSrc).toContain('data-testid="mermaid-diagram"')
  })

  it("surfaces render errors instead of failing silently", () => {
    expect(mermaidSrc).toContain('data-testid="mermaid-error"')
  })
})
