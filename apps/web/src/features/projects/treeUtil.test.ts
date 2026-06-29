import { describe, expect, it } from "bun:test"
import { formatSize, joinPath, parentOf, TREE_INITIAL_EXPANSION, TREE_UNSAFE_CSS } from "./treeUtil"

describe("TREE_INITIAL_EXPANSION", () => {
  it("starts directories collapsed so large repos don't render every file up front", () => {
    // Big repos flood the pane when every directory auto-expands; collapse by
    // default and let the user drill in. See @pierre/trees FileTreeInitialExpansion.
    expect(TREE_INITIAL_EXPANSION).toBe("closed")
  })
})

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
  it("does NOT force the label section to grow (beta.4's decoration lane fills the row)", () => {
    // An older lib version collapsed the name box, so we used to force
    // `[data-item-section='content'] { flex-grow: 1 }`. beta.4 ships a growing
    // decoration lane (`flex: 1 1 0`) that already fills the row; forcing content
    // to grow too made both split the free space, so short names (".pid", "doc")
    // sat in an over-wide box and MiddleTruncate centered them. Regression guard:
    // stay off flex-grow and rely on the native layout (matches trees.software).
    expect(TREE_UNSAFE_CSS).not.toContain("flex-grow")
  })

  it("falls back to native ellipsis under a Safari-only guard (lib's container-query truncation breaks in WebKit)", () => {
    // WebKit mis-resolves font-relative units (lh/em) inside a container-type:size
    // query, so the lib's `@container measure (height > 1lh)` is always true and
    // clips every label. Safari-only, we disable the container-query machinery and
    // fall back to native text-overflow:ellipsis — must not depend on any
    // container query or font-relative threshold.
    expect(TREE_UNSAFE_CSS).toContain("@supports (-webkit-hyphens: none)")
    expect(TREE_UNSAFE_CSS).toContain("text-overflow: ellipsis")
    expect(TREE_UNSAFE_CSS).toContain("[data-truncate-marker-cell]")
    expect(TREE_UNSAFE_CSS).not.toContain("@container")
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
