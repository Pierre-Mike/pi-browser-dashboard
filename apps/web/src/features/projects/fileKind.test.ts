import { describe, expect, it } from "bun:test"
import { basenameOf, classifyFile } from "./fileKind"

describe("classifyFile", () => {
  it("classifies markdown by extension", () => {
    expect(classifyFile("README.md", false)).toBe("markdown")
    expect(classifyFile("docs/intro.MARKDOWN", false)).toBe("markdown")
    expect(classifyFile("post.mdx", false)).toBe("markdown")
  })

  it("classifies html and svg distinctly from images", () => {
    expect(classifyFile("page.html", false)).toBe("html")
    expect(classifyFile("logo.svg", true)).toBe("svg")
    expect(classifyFile("photo.png", true)).toBe("image")
  })

  it("classifies audio and video", () => {
    expect(classifyFile("track.mp3", true)).toBe("audio")
    expect(classifyFile("track.WAV", true)).toBe("audio")
    expect(classifyFile("intro.mp4", true)).toBe("video")
    expect(classifyFile("clip.webm", true)).toBe("video")
  })

  it("classifies pdf", () => {
    expect(classifyFile("guide.pdf", true)).toBe("pdf")
  })

  it("classifies code by extension", () => {
    expect(classifyFile("src/index.ts", false)).toBe("code")
    expect(classifyFile("Component.tsx", false)).toBe("code")
    expect(classifyFile("main.rs", false)).toBe("code")
    expect(classifyFile("package.json", false)).toBe("code")
  })

  it("falls back to text for text files without a known code extension", () => {
    expect(classifyFile("notes.txt", false)).toBe("text")
    expect(classifyFile("server.log", false)).toBe("text")
    expect(classifyFile("Dockerfile", false)).toBe("text")
  })

  it("falls back to binary for unknown extensions when isBinary is true", () => {
    expect(classifyFile("blob.dat", true)).toBe("binary")
    expect(classifyFile("Dockerfile", true)).toBe("binary")
  })
})

describe("basenameOf", () => {
  it("returns the file name", () => {
    expect(basenameOf("src/lib/util.ts")).toBe("util.ts")
    expect(basenameOf("README.md")).toBe("README.md")
    expect(basenameOf("")).toBe("")
  })
})
