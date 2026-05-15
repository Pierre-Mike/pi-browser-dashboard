import { describe, expect, test } from "bun:test"
import { flattenContent } from "./flattenContent"

describe("flattenContent", () => {
  test("returns a text block for a plain string", () => {
    expect(flattenContent("hi")).toEqual([{ kind: "text", text: "hi" }])
  })

  test("emits a thinking block when the thinking text is non-empty", () => {
    const blocks = flattenContent([{ type: "thinking", thinking: "let me see", signature: "sig" }])
    expect(blocks).toEqual([{ kind: "thinking", text: "let me see" }])
  })

  // Claude Code persists finalized thinking blocks with the visible text
  // stripped and only the signature retained. Rendering the chip then
  // produces an empty bubble that expands to nothing — that's the user-
  // facing bug we are fixing.
  test("drops thinking blocks whose text is empty", () => {
    const blocks = flattenContent([{ type: "thinking", thinking: "", signature: "EuACClk..." }])
    expect(blocks).toEqual([])
  })

  test("drops thinking blocks whose text is whitespace-only", () => {
    const blocks = flattenContent([{ type: "thinking", thinking: "   \n  ", signature: "x" }])
    expect(blocks).toEqual([])
  })

  test("preserves non-thinking siblings when an empty thinking block is dropped", () => {
    const blocks = flattenContent([
      { type: "thinking", thinking: "", signature: "x" },
      { type: "text", text: "hello" },
    ])
    expect(blocks).toEqual([{ kind: "text", text: "hello" }])
  })

  test("handles a real-world assistant message: empty thinking + tool_use", () => {
    const blocks = flattenContent([
      { type: "thinking", thinking: "", signature: "EuACClkIDR..." },
      { type: "tool_use", id: "toolu_01", name: "Bash", input: { command: "ls" } },
    ])
    expect(blocks).toEqual([
      { kind: "tool_use", id: "toolu_01", name: "Bash", input: { command: "ls" } },
    ])
  })

  test("still renders tool_use, tool_result, and plain text blocks", () => {
    const blocks = flattenContent([
      { type: "text", text: "ok" },
      { type: "tool_use", id: "t1", name: "Read", input: { file_path: "/x" } },
      { type: "tool_result", content: "done", is_error: false },
    ])
    expect(blocks).toEqual([
      { kind: "text", text: "ok" },
      { kind: "tool_use", id: "t1", name: "Read", input: { file_path: "/x" } },
      { kind: "tool_result", text: "done", isError: false },
    ])
  })
})
