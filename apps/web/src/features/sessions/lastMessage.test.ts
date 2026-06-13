import { describe, expect, test } from "bun:test"
import type { SessionState, TranscriptMessage } from "../../lib/types"
import { lastMessage, resolveLastMessage, sessionFallbackMessage } from "./lastMessage"

const session = (over: Partial<SessionState>): SessionState => ({
  short: "abc123",
  state: "working",
  detail: "",
  tempo: "",
  intent: "",
  name: "demo",
  sessionId: "full-abc123",
  cwd: "/tmp/demo",
  createdAt: "2026-06-13T00:00:00Z",
  updatedAt: "2026-06-13T00:00:00Z",
  linkScanPath: "",
  ...over,
})

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

describe("lastMessage", () => {
  test("returns null for an empty transcript", () => {
    expect(lastMessage([])).toBeNull()
  })

  test("returns the assistant's text when it is the final chat turn", () => {
    const msg = lastMessage([
      userMsg("kick it off"),
      assistantMsg([{ type: "text", text: "All done — anything else?" }]),
    ])
    expect(msg).toEqual({ role: "assistant", text: "All done — anything else?" })
  })

  test("returns the user's text when the user spoke last", () => {
    const msg = lastMessage([
      assistantMsg([{ type: "text", text: "What should I build?" }]),
      userMsg("a login form"),
    ])
    expect(msg).toEqual({ role: "user", text: "a login form" })
  })

  test("joins multiple text blocks in the final assistant turn", () => {
    const msg = lastMessage([
      assistantMsg([
        { type: "text", text: "First line." },
        { type: "text", text: "Second line." },
      ]),
    ])
    expect(msg).toEqual({ role: "assistant", text: "First line.\n\nSecond line." })
  })

  test("skips a trailing tool_result turn to surface the last spoken message", () => {
    // The chronologically last item is a tool_result (no human-readable
    // message to answer); fall back to the prior assistant utterance.
    const msg = lastMessage([
      assistantMsg([
        { type: "text", text: "Running the build." },
        { type: "tool_use", id: "t1", name: "Bash", input: { command: "bun run build" } },
      ]),
      userMsg([{ type: "tool_result", tool_use_id: "t1", content: "ok", is_error: false }]),
    ])
    expect(msg).toEqual({ role: "assistant", text: "Running the build." })
  })

  test("ignores thinking-only and tool-only assistant turns with no visible text", () => {
    const msg = lastMessage([
      assistantMsg([{ type: "text", text: "Here is the plan." }]),
      assistantMsg([{ type: "tool_use", id: "t1", name: "Read", input: { file_path: "a.ts" } }]),
    ])
    expect(msg).toEqual({ role: "assistant", text: "Here is the plan." })
  })

  test("surfaces a final result message when present", () => {
    const msg = lastMessage([
      assistantMsg([{ type: "text", text: "Working…" }]),
      { type: "result", result: "Task complete: shipped the feature." },
    ])
    expect(msg).toEqual({ role: "result", text: "Task complete: shipped the feature." })
  })
})

describe("sessionFallbackMessage", () => {
  test("uses the result of a done session", () => {
    expect(sessionFallbackMessage(session({ state: "done", result: "Shipped." }))).toEqual({
      role: "result",
      text: "Shipped.",
    })
  })

  test("uses detail for a live session", () => {
    expect(
      sessionFallbackMessage(session({ state: "needs_input", detail: "Approve? (y/n)" })),
    ).toEqual({ role: "assistant", text: "Approve? (y/n)" })
  })

  test("returns null when there is nothing to show", () => {
    expect(sessionFallbackMessage(session({ detail: "  ", result: "" }))).toBeNull()
  })
})

describe("resolveLastMessage", () => {
  test("prefers the transcript's last message over the session fallback", () => {
    const msg = resolveLastMessage({
      transcript: [assistantMsg([{ type: "text", text: "From transcript." }])],
      session: session({ detail: "From detail." }),
    })
    expect(msg).toEqual({ role: "assistant", text: "From transcript." })
  })

  test("falls back to the session when the transcript has no message", () => {
    const msg = resolveLastMessage({ transcript: [], session: session({ detail: "From detail." }) })
    expect(msg).toEqual({ role: "assistant", text: "From detail." })
  })

  test("falls back when the transcript is not loaded yet", () => {
    const msg = resolveLastMessage({
      transcript: undefined,
      session: session({ state: "done", result: "Done." }),
    })
    expect(msg).toEqual({ role: "result", text: "Done." })
  })
})
