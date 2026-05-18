import { describe, expect, it } from "bun:test"
import { classifyEmbed, isLoadable } from "./canvasEmbed"

describe("classifyEmbed", () => {
  it("detects image extensions", () => {
    expect(classifyEmbed("https://x.test/a.png")).toBe("image")
    expect(classifyEmbed("a.JPG")).toBe("image")
    expect(classifyEmbed("a.svg?cache=1")).toBe("image")
    expect(classifyEmbed("hero.webp")).toBe("image")
  })

  it("detects pdf, markdown and canvas references", () => {
    expect(classifyEmbed("doc.pdf")).toBe("pdf")
    expect(classifyEmbed("notes/idea.md")).toBe("markdown")
    expect(classifyEmbed("graph.canvas")).toBe("canvas")
  })

  it("falls back to 'other' for arbitrary files", () => {
    expect(classifyEmbed("script.js")).toBe("other")
    expect(classifyEmbed("")).toBe("other")
  })
})

describe("isLoadable", () => {
  it("accepts http(s), absolute, relative, and data URIs", () => {
    expect(isLoadable("https://x.test/a.png")).toBe(true)
    expect(isLoadable("http://x.test/a.png")).toBe(true)
    expect(isLoadable("/local/path.png")).toBe(true)
    expect(isLoadable("./relative.md")).toBe(true)
    expect(isLoadable("data:image/png;base64,xxx")).toBe(true)
  })

  it("rejects untrusted/local paths the browser can't fetch directly", () => {
    expect(isLoadable("~/notes/x.md")).toBe(false)
    expect(isLoadable("C:\\Users\\x\\file.png")).toBe(false)
    expect(isLoadable("")).toBe(false)
  })
})
