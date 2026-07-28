// Local mirror of the daemon's terminal-state classification shape (see
// apps/daemon/src/features/terminal/terminal-state.core.ts). Kept as a
// subset of SessionStateValue so `stateColor` in lib/format.ts can be reused
// directly for the terminal chip — one tone palette for "working" across
// both session cards and terminal chips.
export type TerminalStateSlug = "working" | "blocked" | "idle" | "unknown"

export type TerminalStateEvent = {
  readonly scope: string
  readonly id: string
  readonly state: TerminalStateSlug
  readonly matcher?: string
  readonly evidence?: string
  readonly at: string
}

// Matches terminalStateKey in the daemon core — the SSE payload and
// GET /terminal/states are both keyed this way.
export const terminalStateKey = (input: { readonly scope: string; readonly id: string }): string =>
  `${input.scope}:${input.id}`

// Tooltip text for the chip: which matcher fired and the exact line that
// triggered it, so a human can see *why* — same instinct as
// GET /sessions/:id/explain.
export const terminalStateTitle = (event: TerminalStateEvent): string => {
  if (!event.matcher) return "unknown — no matcher has fired yet"
  return event.evidence ? `${event.matcher}: ${event.evidence}` : event.matcher
}
