import { isRecord } from "../../lib/guards"
import type { TranscriptMessage } from "../../lib/types"

// The slice of a fetch Response this parser needs. Kept structural so the hc
// client's response and a test stub both satisfy it.
export type TranscriptResponse = {
  readonly ok: boolean
  readonly status: number
  json: () => Promise<unknown>
}

const TRANSCRIPT_TYPES: readonly TranscriptMessage["type"][] = [
  "user",
  "assistant",
  "tool_use",
  "tool_result",
  "system",
  "result",
]

// A transcript row is only trusted as far as its `type` discriminant: the JSONL
// payload varies per type and the renderer already treats `content`/`input` as
// `unknown`, falling back to a <pre> dump. So this checks the one field the UI
// branches on and refuses to assert the rest — which is the difference between a
// guard and the `as` that used to be here.
const isTranscriptMessage = (v: unknown): v is TranscriptMessage =>
  isRecord(v) && (TRANSCRIPT_TYPES as readonly unknown[]).includes(v.type)

// Accepts either wire shape the daemon may answer with — a bare array, or an
// envelope with `messages` — and drops rows that are not recognizable messages
// rather than handing the renderer something it will crash on.
const messagesFrom = (body: unknown): readonly TranscriptMessage[] => {
  if (Array.isArray(body)) return body.filter(isTranscriptMessage)
  if (isRecord(body) && Array.isArray(body.messages)) {
    return body.messages.filter(isTranscriptMessage)
  }
  return []
}

// Turn a transcript HTTP response into a message list.
//
// A 404 is NOT an error here: a freshly spawned session has no transcript
// JSONL yet (the daemon answers no_transcript / ENOENT until the link is
// written), so we read it as an empty, not-yet-ready transcript. The chat then
// shows cleanly and the query keeps polling until the file appears, instead of
// painting "Failed to load transcript: HTTP 404" during the startup window.
// Any other non-ok status is a genuine failure and throws so the query surfaces
// it.
export const parseTranscriptResponse = async (
  res: TranscriptResponse,
): Promise<readonly TranscriptMessage[]> => {
  if (res.status === 404) return []
  if (!res.ok) throw new Error(`transcript: HTTP ${res.status}`)
  return messagesFrom(await res.json())
}
