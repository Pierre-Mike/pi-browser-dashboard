import type { SessionState, TranscriptMessage } from "../../lib/types"
import {
  type PairedBlock,
  pairTranscript,
  type TranscriptItem,
} from "../transcripts/pairTranscript"

export type LastMessageRole = "assistant" | "user" | "result"

export type LastMessage = { role: LastMessageRole; text: string }

// Join the human-readable text blocks of a chat turn. Tool calls, tool
// results, and (empty) thinking blocks carry no message to answer, so they
// are dropped — a turn that is only those reads as "no visible text".
const visibleText = (blocks: readonly PairedBlock[]): string =>
  blocks
    .filter((b): b is Extract<PairedBlock, { kind: "text" }> => b.kind === "text")
    .map((b) => b.text.trim())
    .filter((t) => t.length > 0)
    .join("\n\n")

const itemMessage = (item: TranscriptItem): LastMessage | null => {
  if (item.kind === "result") {
    const text = item.text.trim()
    return text.length > 0 ? { role: "result", text } : null
  }
  if (item.kind === "user" || item.kind === "assistant") {
    const text = visibleText(item.blocks)
    return text.length > 0 ? { role: item.kind, text } : null
  }
  // tool_results carry no message to answer.
  return null
}

// The most recent human-readable message in a session transcript — the thing a
// user would reply to. Walks the paired transcript from the end and returns the
// last assistant/user/result turn that has visible text, skipping tool-only
// and empty turns. Returns null when the transcript has nothing to show.
export const lastMessage = (messages: readonly TranscriptMessage[]): LastMessage | null => {
  const items = pairTranscript(messages)
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]
    if (!item) continue
    const msg = itemMessage(item)
    if (msg) return msg
  }
  return null
}

// Best-effort "last message" from the session registry entry alone — used
// before (or instead of) the transcript JSONL being readable. A finished
// session's `result` is its closing word; otherwise `detail` is the latest
// status line the supervisor recorded.
export const sessionFallbackMessage = (session: SessionState): LastMessage | null => {
  const result = session.result?.trim()
  if (session.state === "done" && result) return { role: "result", text: result }
  const detail = session.detail?.trim()
  if (detail) return { role: "assistant", text: detail }
  return null
}

// The message a user would reply to: the transcript's last message when the
// JSONL has loaded, otherwise the session registry fallback.
export const resolveLastMessage = ({
  transcript,
  session,
}: {
  transcript: readonly TranscriptMessage[] | undefined
  session: SessionState
}): LastMessage | null =>
  (transcript ? lastMessage(transcript) : null) ?? sessionFallbackMessage(session)
