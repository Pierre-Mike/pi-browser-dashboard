import { describe, expect, it } from "bun:test"
import { createTargetPath, dropMoves, fsNameError } from "./fsOps"

describe("fsNameError", () => {
  it("accepts an ordinary name", () => {
    expect(fsNameError("index.ts")).toBeNull()
    expect(fsNameError("  spaced.md  ")).toBeNull()
  })
  it("rejects an empty / whitespace-only name", () => {
    expect(fsNameError("")).not.toBeNull()
    expect(fsNameError("   ")).not.toBeNull()
  })
  it("rejects path separators and reserved names", () => {
    expect(fsNameError("a/b")).not.toBeNull()
    expect(fsNameError("a\\b")).not.toBeNull()
    expect(fsNameError(".")).not.toBeNull()
    expect(fsNameError("..")).not.toBeNull()
  })
})

describe("createTargetPath", () => {
  it("nests a new entry inside a directory target (canonical trailing slash)", () => {
    expect(createTargetPath({ path: "src/components/", kind: "directory" }, "Button.tsx")).toBe(
      "src/components/Button.tsx",
    )
  })
  it("creates a sibling next to a file target", () => {
    expect(createTargetPath({ path: "src/index.ts", kind: "file" }, "util.ts")).toBe("src/util.ts")
  })
  it("trims the name", () => {
    expect(createTargetPath({ path: "", kind: "directory" }, "  top.txt ")).toBe("top.txt")
  })
})

describe("dropMoves", () => {
  it("moves each dragged path under the target directory keeping its basename", () => {
    expect(dropMoves(["a/x.ts", "b/y.ts"], { directoryPath: "dest/", kind: "directory" })).toEqual([
      { from: "a/x.ts", to: "dest/x.ts" },
      { from: "b/y.ts", to: "dest/y.ts" },
    ])
  })
  it("drops onto the root when target kind is root", () => {
    expect(dropMoves(["deep/z.ts"], { directoryPath: null, kind: "root" })).toEqual([
      { from: "deep/z.ts", to: "z.ts" },
    ])
  })
  it("moves a dragged directory (trailing slash) keeping its name", () => {
    expect(dropMoves(["a/old/"], { directoryPath: "b/", kind: "directory" })).toEqual([
      { from: "a/old", to: "b/old" },
    ])
  })
  it("skips no-op moves (already in the target dir)", () => {
    expect(dropMoves(["dest/x.ts"], { directoryPath: "dest/", kind: "directory" })).toEqual([])
  })
  it("skips moving a directory into its own descendant", () => {
    expect(dropMoves(["dir/"], { directoryPath: "dir/sub/", kind: "directory" })).toEqual([])
  })
})
