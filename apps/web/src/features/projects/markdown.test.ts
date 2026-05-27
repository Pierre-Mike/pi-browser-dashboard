import { describe, expect, it } from "bun:test"
import { parseInline, parseMarkdown } from "./markdown"

describe("parseInline", () => {
  it("returns plain text for text without markers", () => {
    expect(parseInline("hello world")).toEqual([{ kind: "text", text: "hello world" }])
  })

  it("parses inline code", () => {
    expect(parseInline("run `make build` now")).toEqual([
      { kind: "text", text: "run " },
      { kind: "code", text: "make build" },
      { kind: "text", text: " now" },
    ])
  })

  it("parses bold and italic", () => {
    expect(parseInline("**bold** and *em*")).toEqual([
      { kind: "strong", spans: [{ kind: "text", text: "bold" }] },
      { kind: "text", text: " and " },
      { kind: "em", spans: [{ kind: "text", text: "em" }] },
    ])
  })

  it("parses safe links", () => {
    expect(parseInline("[docs](https://example.com)")).toEqual([
      {
        kind: "link",
        href: "https://example.com",
        spans: [{ kind: "text", text: "docs" }],
      },
    ])
  })

  it("rejects javascript: links and keeps them as text", () => {
    const out = parseInline("[x](javascript:alert(1))")
    expect(out.some((s) => s.kind === "link")).toBe(false)
  })
})

describe("parseMarkdown", () => {
  it("parses headings of different levels", () => {
    expect(parseMarkdown("# h1\n\n### h3")).toEqual([
      { kind: "heading", level: 1, spans: [{ kind: "text", text: "h1" }] },
      { kind: "heading", level: 3, spans: [{ kind: "text", text: "h3" }] },
    ])
  })

  it("parses fenced code blocks with language", () => {
    const md = "```ts\nconst x = 1\n```"
    expect(parseMarkdown(md)).toEqual([{ kind: "code", lang: "ts", text: "const x = 1" }])
  })

  it("parses unordered lists", () => {
    const md = "- one\n- two\n- three"
    const blocks = parseMarkdown(md)
    expect(blocks).toHaveLength(1)
    expect(blocks[0]?.kind).toBe("ul")
    if (blocks[0]?.kind === "ul") expect(blocks[0].items).toHaveLength(3)
  })

  it("parses ordered lists", () => {
    const blocks = parseMarkdown("1. a\n2. b")
    expect(blocks[0]?.kind).toBe("ol")
  })

  it("parses blockquotes", () => {
    const blocks = parseMarkdown("> wisdom\n> goes here")
    expect(blocks[0]?.kind).toBe("blockquote")
  })

  it("parses horizontal rules", () => {
    expect(parseMarkdown("---\n")[0]?.kind).toBe("hr")
  })

  it("groups consecutive non-blank lines into a single paragraph", () => {
    const blocks = parseMarkdown("hello\nworld\n\nnext")
    expect(blocks).toHaveLength(2)
    expect(blocks[0]?.kind).toBe("paragraph")
    expect(blocks[1]?.kind).toBe("paragraph")
  })

  it("parses GFM tables with header, alignment row, and body", () => {
    const md = ["| Layer | Choice |", "| ----- | ------ |", "| Repo  | bun    |"].join("\n")
    const blocks = parseMarkdown(md)
    expect(blocks).toHaveLength(1)
    const t = blocks[0]
    expect(t?.kind).toBe("table")
    if (t?.kind === "table") {
      expect(t.headers).toEqual([
        [{ kind: "text", text: "Layer" }],
        [{ kind: "text", text: "Choice" }],
      ])
      expect(t.rows).toEqual([
        [[{ kind: "text", text: "Repo" }], [{ kind: "text", text: "bun" }]],
      ])
    }
  })

  it("parses table column alignment from the separator row", () => {
    const md = [
      "| L | C | R |",
      "| :-- | :--: | --: |",
      "| a | b | c |",
    ].join("\n")
    const blocks = parseMarkdown(md)
    const t = blocks[0]
    expect(t?.kind).toBe("table")
    if (t?.kind === "table") {
      expect(t.aligns).toEqual(["left", "center", "right"])
    }
  })

  it("falls back to paragraph for pipe-rows without a separator row", () => {
    const md = "| not | a table |\n| because | no sep |"
    const blocks = parseMarkdown(md)
    expect(blocks[0]?.kind).toBe("paragraph")
  })

  it("parses inline markdown inside table cells", () => {
    const md = ["| col |", "| --- |", "| **bold** `code` |"].join("\n")
    const blocks = parseMarkdown(md)
    const t = blocks[0]
    expect(t?.kind).toBe("table")
    if (t?.kind === "table") {
      expect(t.rows[0]?.[0]).toEqual([
        { kind: "strong", spans: [{ kind: "text", text: "bold" }] },
        { kind: "text", text: " " },
        { kind: "code", text: "code" },
      ])
    }
  })
})
