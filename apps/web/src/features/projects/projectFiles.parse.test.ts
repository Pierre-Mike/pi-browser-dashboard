import { describe, expect, it } from "bun:test"
import {
  type ProjectTree,
  parseErrorField,
  parseFileContent,
  parseProjectTree,
} from "./projectFiles.parse"

describe("parseProjectTree", () => {
  it("accepts a tree with no gitStatus", () => {
    expect(parseProjectTree({ paths: ["a.ts", "b.ts"], truncated: false })).toEqual({
      paths: ["a.ts", "b.ts"],
      truncated: false,
    })
  })

  it("accepts a tree with a well-formed gitStatus", () => {
    const tree: ProjectTree = {
      paths: ["a.ts"],
      truncated: false,
      gitStatus: [{ path: "a.ts", status: "modified" }],
    }
    expect(parseProjectTree(tree)).toEqual(tree)
  })

  it("rejects an unrecognized git status", () => {
    expect(
      parseProjectTree({
        paths: ["a.ts"],
        truncated: false,
        gitStatus: [{ path: "a.ts", status: "conflicted" }],
      }),
    ).toBeNull()
  })

  it("rejects a non-string-array paths or wrong-typed truncated", () => {
    expect(parseProjectTree({ paths: "a.ts", truncated: false })).toBeNull()
    expect(parseProjectTree({ paths: [], truncated: "no" })).toBeNull()
  })

  it("rejects a non-object", () => {
    expect(parseProjectTree(null)).toBeNull()
  })
})

describe("parseFileContent", () => {
  const valid = { path: "a.ts", size: 12, isBinary: false, truncated: false, content: "export {}" }

  it("accepts a well-formed file", () => {
    expect(parseFileContent(valid)).toEqual(valid)
  })

  it("rejects a wrong-typed field", () => {
    expect(parseFileContent({ ...valid, size: "12" })).toBeNull()
  })

  it("rejects a non-object", () => {
    expect(parseFileContent(null)).toBeNull()
  })
})

describe("parseErrorField", () => {
  it("extracts a string error", () => {
    expect(parseErrorField({ error: "path escapes project root" })).toBe(
      "path escapes project root",
    )
  })

  it("returns undefined when error is missing or not a string", () => {
    expect(parseErrorField({})).toBeUndefined()
    expect(parseErrorField({ error: 1 })).toBeUndefined()
    expect(parseErrorField(null)).toBeUndefined()
  })
})
