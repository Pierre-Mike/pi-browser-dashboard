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

// Session-state slugs each terminal classification is really asserting the same
// thing as. Used to decide whether a card's terminal chip is news; see
// terminalStateAddsInfo.
//
// Exported for scripts/mirrored-constants.test.ts only: the daemon's
// GET /sessions/:id/explain makes the same judgement over its own copy
// (`SCREEN_AGREES_WITH` in sessions-explain.core.ts) and neither app may import
// the other, so a test outside both holds them to each other.
export const AGREES_WITH: Record<TerminalStateSlug, readonly string[]> = {
  working: ["working"],
  // "blocked" and the supervisor's "needs_input" are one fact under two names.
  blocked: ["blocked", "needs_input"],
  // A resting screen agrees with EVERY not-running supervisor state, not just
  // `idle`. A finished session naturally sits at its prompt, so pairing `done`
  // with a screen that reads `idle` is confirmation, not news — measured against
  // the live daemon, treating those as a disagreement put a chip on 14 of 21
  // cards, 13 of them saying "IDLE" beside "DONE". Restricting it left exactly
  // the two that matter: a `working` card whose screen is resting (stale or
  // hung), and a `blocked` card whose screen is still generating.
  idle: ["idle", "done", "stopped", "failed"],
  // Never reached — an unknown screen is filtered out before the lookup.
  unknown: [],
}

// Whether a session card should spend space on a terminal chip beside the
// supervisor's own state badge. It should only when the screen DISAGREES: that
// is the case the unattended poller exists to surface (a session the supervisor
// reports idle whose screen shows a spinner, or a permission prompt nobody has
// answered). Agreement, and an unclassified screen, both stay silent.
export const terminalStateAddsInfo = (input: {
  readonly sessionState: string
  readonly terminal: TerminalStateEvent | undefined
}): boolean => {
  const event = input.terminal
  if (event === undefined || event.state === "unknown") return false
  return !AGREES_WITH[event.state].includes(input.sessionState)
}

// Tooltip text for the chip: which matcher fired and the exact line that
// triggered it, so a human can see *why* — same instinct as
// GET /sessions/:id/explain.
export const terminalStateTitle = (event: TerminalStateEvent): string => {
  if (!event.matcher) return "unknown — no matcher has fired yet"
  return event.evidence ? `${event.matcher}: ${event.evidence}` : event.matcher
}
