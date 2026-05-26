import { describe, expect, it } from "bun:test"
import { appendPath } from "./appendPath"

describe("appendPath", () => {
  it("replaces an empty input with the path", () => {
    expect(appendPath("", "/abs/note.txt")).toBe("/abs/note.txt")
  })

  it("appends with a separating space when the input has content", () => {
    expect(appendPath("review this", "/abs/note.txt")).toBe("review this /abs/note.txt")
  })

  it("preserves a trailing space rather than doubling it", () => {
    expect(appendPath("review this ", "/abs/note.txt")).toBe("review this /abs/note.txt")
  })

  it("preserves a trailing newline rather than adding a space", () => {
    expect(appendPath("review:\n", "/abs/note.txt")).toBe("review:\n/abs/note.txt")
  })

  it("is a no-op when path is empty", () => {
    expect(appendPath("hello", "")).toBe("hello")
  })
})
