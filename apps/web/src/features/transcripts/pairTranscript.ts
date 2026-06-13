import type { TranscriptMessage } from "../../lib/types"
import { asString, flattenContent } from "./flattenContent"

export type ToolResultInfo = { text: string; isError: boolean }

export type PairedBlock =
  | { kind: "text"; text: string }
  | { kind: "thinking"; text: string }
  | { kind: "tool_use"; name: string; input: unknown; id?: string; result?: ToolResultInfo }
  | { kind: "tool_result"; text: string; isError?: boolean; toolUseId?: string }

export type TranscriptItem =
  | { kind: "user"; blocks: PairedBlock[]; timestamp?: string }
  | { kind: "assistant"; blocks: PairedBlock[]; timestamp?: string }
  | { kind: "tool_results"; blocks: PairedBlock[]; timestamp?: string }
  | { kind: "result"; text: string; timestamp?: string }

const extractRole = (m: TranscriptMessage): string => {
  if (m.message && typeof m.message === "object") {
    const role = (m.message as Record<string, unknown>).role
    if (typeof role === "string") return role
  }
  return m.type
}

const extractContent = (m: TranscriptMessage): unknown => {
  if (m.content !== undefined) return m.content
  if (m.message && typeof m.message === "object") {
    return (m.message as Record<string, unknown>).content
  }
  if (typeof m.text === "string") return m.text
  return null
}

// Mastra-playground-style pairing: tool_result rows arrive in later user-role
// messages; fold each into its originating tool_use by tool_use_id so the UI
// can render one card per call. Results with no visible match stay standalone.
export const pairTranscript = (messages: readonly TranscriptMessage[]): TranscriptItem[] => {
  const items: TranscriptItem[] = []
  const open = new Map<string, Extract<PairedBlock, { kind: "tool_use" }>>()

  for (const m of messages) {
    const role = extractRole(m)
    const isChatRole = role === "user" || role === "assistant" || role === "result"
    if (!isChatRole && m.type !== "result") continue

    if (role === "assistant") {
      const blocks: PairedBlock[] = flattenContent(extractContent(m)).map((b) => ({ ...b }))
      if (blocks.length === 0) continue
      for (const b of blocks) {
        if (b.kind === "tool_use" && b.id) open.set(b.id, b)
      }
      items.push({ kind: "assistant", blocks, timestamp: m.timestamp })
      continue
    }

    if (role === "user") {
      const blocks: PairedBlock[] = flattenContent(extractContent(m)).map((b) => ({ ...b }))
      const remaining = blocks.filter((b) => {
        if (b.kind !== "tool_result" || !b.toolUseId) return true
        const target = open.get(b.toolUseId)
        if (!target) return true
        target.result = { text: b.text, isError: Boolean(b.isError) }
        open.delete(b.toolUseId)
        return false
      })
      if (remaining.length === 0) continue
      const allToolResults = remaining.every((b) => b.kind === "tool_result")
      items.push({
        kind: allToolResults ? "tool_results" : "user",
        blocks: remaining,
        timestamp: m.timestamp,
      })
      continue
    }

    const text = typeof m.result === "string" ? m.result : asString(extractContent(m))
    if (!text || text === "null") continue
    items.push({ kind: "result", text, timestamp: m.timestamp })
  }

  return items
}

// React key for a transcript row. The array index is always appended so two
// same-kind rows sharing a second-resolution timestamp can never collide (which
// otherwise makes React duplicate/omit messages).
export const transcriptItemKey = (item: TranscriptItem, index: number): string =>
  `msg-${item.timestamp || index}-${item.kind}-${index}`
