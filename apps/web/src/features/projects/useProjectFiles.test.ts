import { describe, expect, it } from "bun:test"
import type { FileResource } from "./useProjectFiles"
import { fileDownloadUrl, fileRawUrl, projectDownloadUrl, projectRawUrl } from "./useProjectFiles"

describe("fileRawUrl", () => {
  it("builds a projects raw URL", () => {
    const r: FileResource = { kind: "projects", id: "proj" }
    const url = new URL(fileRawUrl(r, "src/index.ts"))
    expect(url.pathname).toBe("/projects/proj/raw")
    expect(url.searchParams.get("path")).toBe("src/index.ts")
  })

  it("builds a sessions raw URL", () => {
    const r: FileResource = { kind: "sessions", id: "abcd" }
    const url = new URL(fileRawUrl(r, "src/foo.ts"))
    expect(url.pathname).toBe("/sessions/abcd/raw")
    expect(url.searchParams.get("path")).toBe("src/foo.ts")
  })

  it("encodes the id", () => {
    const r: FileResource = { kind: "projects", id: "a/b" }
    const url = new URL(fileRawUrl(r, "x.txt"))
    expect(url.pathname).toBe("/projects/a%2Fb/raw")
  })
})

describe("fileDownloadUrl", () => {
  it("adds download=1 for projects resource", () => {
    const r: FileResource = { kind: "projects", id: "proj" }
    const url = new URL(fileDownloadUrl(r, "src/index.ts"))
    expect(url.pathname).toBe("/projects/proj/raw")
    expect(url.searchParams.get("download")).toBe("1")
  })

  it("adds download=1 for sessions resource", () => {
    const r: FileResource = { kind: "sessions", id: "abcd" }
    const url = new URL(fileDownloadUrl(r, "src/foo.ts"))
    expect(url.pathname).toBe("/sessions/abcd/raw")
    expect(url.searchParams.get("path")).toBe("src/foo.ts")
    expect(url.searchParams.get("download")).toBe("1")
  })
})

describe("projectDownloadUrl (legacy wrapper)", () => {
  it("targets the raw endpoint with download=1", () => {
    const url = new URL(projectDownloadUrl("proj", "src/index.ts"))
    expect(url.pathname).toBe("/projects/proj/raw")
    expect(url.searchParams.get("path")).toBe("src/index.ts")
    expect(url.searchParams.get("download")).toBe("1")
  })

  it("matches the raw url except for the download flag", () => {
    const raw = new URL(projectRawUrl("proj", "a/b.png"))
    const dl = new URL(projectDownloadUrl("proj", "a/b.png"))
    expect(dl.searchParams.get("path")).toBe(raw.searchParams.get("path"))
    expect(raw.searchParams.has("download")).toBe(false)
    expect(dl.searchParams.get("download")).toBe("1")
  })

  it("encodes the project id", () => {
    const url = new URL(projectDownloadUrl("a/b", "x.txt"))
    expect(url.pathname).toBe("/projects/a%2Fb/raw")
  })
})
