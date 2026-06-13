import { describe, expect, it } from "bun:test"
import { formatSize, joinPath, parentOf, TREE_UNSAFE_CSS } from "./treeUtil"

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

describe("TREE_UNSAFE_CSS", () => {
  it("lets the row label section grow so short names stop middle-truncating", () => {
    // Targets the lib's label box and overrides its `flex: 0 1 auto` so the
    // name fills the free row width. Regression guard for the over-truncation.
    expect(TREE_UNSAFE_CSS).toContain("[data-item-section='content']")
    expect(TREE_UNSAFE_CSS).toContain("flex-grow: 1")
  })

  it("re-detects overflow with em under a Safari-only guard (lib's 1lh query breaks in WebKit)", () => {
    // WebKit resolves `lh` to ~0 inside a container-type:size query, so the
    // lib's `@container measure (height > 1lh)` is always true and over-truncates
    // every label. The override must be Safari-scoped and use an `em` threshold,
    // and must not reintroduce a 1lh container condition.
    expect(TREE_UNSAFE_CSS).toContain("@supports (-webkit-hyphens: none)")
    expect(TREE_UNSAFE_CSS).toContain("@container measure (height > 2em)")
    expect(TREE_UNSAFE_CSS).toContain("[data-truncate-marker]")
    expect(TREE_UNSAFE_CSS).not.toContain("1lh")
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
