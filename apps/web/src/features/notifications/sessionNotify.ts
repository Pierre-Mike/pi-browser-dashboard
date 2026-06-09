import type { SessionState, SessionStateValue } from "../../lib/types"

export type NotifyPayload = {
  title: string
  body: string
  // Stable per session+state so the browser coalesces duplicates instead of
  // stacking a notification per redundant event.
  tag: string
}

const TERMINAL_STATES: ReadonlySet<SessionStateValue> = new Set<SessionStateValue>([
  "done",
  "failed",
  "stopped",
])

export const isTerminalState = (state: SessionStateValue): boolean => TERMINAL_STATES.has(state)

const TITLES: Record<"done" | "failed" | "stopped", string> = {
  done: "✓ Claude session done",
  failed: "✗ Claude session failed",
  stopped: "■ Claude session stopped",
}

const BODY_MAX = 160

const truncate = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text

const label = (s: SessionState): string => s.name.trim() || s.intent.trim() || s.short

// Decide whether a session state transition warrants a desktop notification.
//
// Only the *edge* into a terminal state fires. We deliberately do NOT notify
// when `prev` is undefined: that is the first time the client has seen this
// session this connection (page load, or an SSE reconnect's first event for a
// session), and notifying there would spam stale terminal states the user did
// not just witness finish.
export const decideNotification = (
  prev: SessionStateValue | undefined,
  next: SessionState,
): NotifyPayload | null => {
  if (!isTerminalState(next.state)) return null
  if (prev === undefined) return null
  if (isTerminalState(prev)) return null

  const title = TITLES[next.state as "done" | "failed" | "stopped"]
  const detail = (next.result ?? next.detail ?? "").trim()
  const who = label(next)
  const body = truncate(detail ? `${who} — ${detail}` : who, BODY_MAX)
  return { title, body, tag: `pid-session-${next.short}-${next.state}` }
}
