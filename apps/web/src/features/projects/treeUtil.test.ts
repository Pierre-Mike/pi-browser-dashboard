import { describe, expect, it } from "bun:test"
import { formatSize, joinPath, parentOf } from "./treeUtil"

describe("joinPath", () => {
  it("returns the name when parent is empty", () => {
    expect(joinPath("", "src")).toBe("src")
  })
  it("joins with a single slash", () => {
    expect(joinPath("src", "index.ts")).toBe("src/index.ts")
    expect(joinPath("a/b", "c")).toBe("a/b/c")
  })
})

describe("parentOf", () => {
  it("returns empty for top-level entries", () => {
    expect(parentOf("README.md")).toBe("")
  })
  it("strips the last segment", () => {
    expect(parentOf("src/lib/util.ts")).toBe("src/lib")
  })
})

describe("formatSize", () => {
  it("uses bytes under 1 KiB", () => {
    expect(formatSize(0)).toBe("0 B")
    expect(formatSize(512)).toBe("512 B")
  })
  it("uses KB under 1 MiB", () => {
    expect(formatSize(2048)).toBe("2.0 KB")
  })
  it("uses MB under 1 GiB", () => {
    expect(formatSize(5 * 1024 * 1024)).toBe("5.0 MB")
  })
})
