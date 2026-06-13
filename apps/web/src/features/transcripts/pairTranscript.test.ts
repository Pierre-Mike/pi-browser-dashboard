import { describe, expect, test } from "bun:test"
import type { TranscriptMessage } from "../../lib/types"
import { pairTranscript, type TranscriptItem, transcriptItemKey } from "./pairTranscript"

const assistantMsg = (content: unknown[], timestamp?: string): TranscriptMessage => ({
  type: "assistant",
  message: { role: "assistant", content },
  timestamp,
})

const userMsg = (content: unknown, timestamp?: string): TranscriptMessage => ({
  type: "user",
  message: { role: "user", content },
  timestamp,
})

describe("pairTranscript", () => {
  test("attaches a tool_result to the matching tool_use by tool_use_id", () => {
    const items = pairTranscript([
      assistantMsg([{ type: "tool_use", id: "t1", name: "Bash", input: { command: "ls" } }]),
      userMsg([{ type: "tool_result", tool_use_id: "t1", content: "file.txt", is_error: false }]),
    ])
    expect(items).toEqual([
      {
        kind: "assistant",
        timestamp: undefined,
        blocks: [
          {
            kind: "tool_use",
            id: "t1",
            name: "Bash",
            input: { command: "ls" },
            result: { text: "file.txt", isError: false },
          },
        ],
      },
    ])
  })

  test("marks errored tool results", () => {
    const items = pairTranscript([
      assistantMsg([{ type: "tool_use", id: "t1", name: "Bash", input: { command: "boom" } }]),
      userMsg([{ type: "tool_result", tool_use_id: "t1", content: "exit 1", is_error: true }]),
    ])
    expect(items[0]).toMatchObject({
      blocks: [{ kind: "tool_use", result: { text: "exit 1", isError: true } }],
    })
  })

  test("leaves tool_use without a result pending (no result field)", () => {
    const items = pairTranscript([
      assistantMsg([{ type: "tool_use", id: "t1", name: "Read", input: { file_path: "/x" } }]),
    ])
    expect(items).toEqual([
      {
        kind: "assistant",
        timestamp: undefined,
        blocks: [{ kind: "tool_use", id: "t1", name: "Read", input: { file_path: "/x" } }],
      },
    ])
  })

  test("matches multiple tool_uses to their results by id, not order", () => {
    const items = pairTranscript([
      assistantMsg([
        { type: "tool_use", id: "a", name: "Read", input: { file_path: "/a" } },
        { type: "tool_use", id: "b", name: "Read", input: { file_path: "/b" } },
      ]),
      userMsg([
        { type: "tool_result", tool_use_id: "b", content: "B", is_error: false },
        { type: "tool_result", tool_use_id: "a", content: "A", is_error: false },
      ]),
    ])
    expect(items).toHaveLength(1)
    const blocks = items[0]?.kind === "assistant" ? items[0].blocks : []
    expect(blocks[0]).toMatchObject({ id: "a", result: { text: "A" } })
    expect(blocks[1]).toMatchObject({ id: "b", result: { text: "B" } })
  })

  test("emits unmatched tool_results as a standalone tool_results item", () => {
    const items = pairTranscript([
      userMsg([{ type: "tool_result", tool_use_id: "ghost", content: "orphan", is_error: false }]),
    ])
    expect(items).toEqual([
      {
        kind: "tool_results",
        timestamp: undefined,
        blocks: [{ kind: "tool_result", text: "orphan", isError: false, toolUseId: "ghost" }],
      },
    ])
  })

  test("keeps user text and strips matched tool_results from the same message", () => {
    const items = pairTranscript([
      assistantMsg([{ type: "tool_use", id: "t1", name: "Bash", input: { command: "ls" } }]),
      userMsg([
        { type: "tool_result", tool_use_id: "t1", content: "ok", is_error: false },
        { type: "text", text: "continue please" },
      ]),
    ])
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({
      kind: "assistant",
      blocks: [{ kind: "tool_use", result: { text: "ok" } }],
    })
    expect(items[1]).toEqual({
      kind: "user",
      timestamp: undefined,
      blocks: [{ kind: "text", text: "continue please" }],
    })
  })

  test("renders plain user and assistant text messages", () => {
    const items = pairTranscript([
      userMsg("hello", "2026-06-10T10:00:00Z"),
      assistantMsg([{ type: "text", text: "hi" }], "2026-06-10T10:00:01Z"),
    ])
    expect(items).toEqual([
      {
        kind: "user",
        timestamp: "2026-06-10T10:00:00Z",
        blocks: [{ kind: "text", text: "hello" }],
      },
      {
        kind: "assistant",
        timestamp: "2026-06-10T10:00:01Z",
        blocks: [{ kind: "text", text: "hi" }],
      },
    ])
  })

  test("skips housekeeping rows and empty messages", () => {
    const items = pairTranscript([
      { type: "system", subtype: "queue-operation" } as unknown as TranscriptMessage,
      userMsg([]),
      assistantMsg([]),
    ])
    expect(items).toEqual([])
  })

  test("emits result rows with their text and drops null results", () => {
    const items = pairTranscript([
      { type: "result", result: "All done", timestamp: "2026-06-10T10:05:00Z" },
      { type: "result", result: undefined },
    ])
    expect(items).toEqual([{ kind: "result", text: "All done", timestamp: "2026-06-10T10:05:00Z" }])
  })
})

describe("transcriptItemKey", () => {
  test("disambiguates same-kind same-timestamp items by index", () => {
    const ts = "2026-06-11T16:42:34Z"
    const items: TranscriptItem[] = [
      { kind: "user", blocks: [{ kind: "text", text: "hi" }], timestamp: ts },
      { kind: "user", blocks: [{ kind: "text", text: "again" }], timestamp: ts },
    ]
    const a = transcriptItemKey(items[0] as TranscriptItem, 0)
    const b = transcriptItemKey(items[1] as TranscriptItem, 1)
    expect(a).not.toBe(b)
  })

  test("yields a unique key for every item in a transcript", () => {
    const ts = "2026-06-11T16:42:34Z"
    const items: TranscriptItem[] = [
      { kind: "user", blocks: [], timestamp: ts },
      { kind: "user", blocks: [], timestamp: ts },
      { kind: "assistant", blocks: [], timestamp: ts },
      { kind: "assistant", blocks: [] },
      { kind: "result", text: "done" },
    ]
    const keys = items.map((item, i) => transcriptItemKey(item, i))
    expect(new Set(keys).size).toBe(items.length)
  })
})
