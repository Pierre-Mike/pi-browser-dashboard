import { describe, expect, it } from "bun:test"
import { projectDownloadUrl, projectRawUrl } from "./useProjectFiles"

describe("projectDownloadUrl", () => {
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
