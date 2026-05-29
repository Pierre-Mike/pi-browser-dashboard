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
    // The initialize call must be outside any function / arrow function that is
    // used as a useEffect callback — we look for a top-level `initialized` flag.
    expect(mermaidSrc).toMatch(/let initialized/)
    // initialize should be guarded so it runs only once
    expect(mermaidSrc).toMatch(/if\s*\(!initialized\)/)
  })

  it("exposes a stable testid for the rendered diagram", () => {
    expect(mermaidSrc).toContain('data-testid="mermaid-diagram"')
  })

  it("surfaces render errors instead of failing silently", () => {
    expect(mermaidSrc).toContain('data-testid="mermaid-error"')
  })
})
