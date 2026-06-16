import type { TranscriptMessage } from "../../lib/types"

// The slice of a fetch Response this parser needs. Kept structural so the hc
// client's response and a test stub both satisfy it.
export type TranscriptResponse = {
  readonly ok: boolean
  readonly status: number
  json: () => Promise<unknown>
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
  const body = (await res.json()) as TranscriptMessage[] | { messages?: TranscriptMessage[] }
  return Array.isArray(body) ? body : (body.messages ?? [])
}
