import { stateColor } from "../../lib/format"
import { type TerminalStateEvent, terminalStateTitle } from "./terminalState"

// Small chip for the terminal footer bar, next to the ws-status pill and the
// restart/reconnect controls. Renders nothing until the daemon has actually
// classified this terminal at least once (GET /terminal/states on mount, or
// the first `terminal.state` SSE event) — no chip is more honest than a
// guessed one.
export const TerminalStateChip = ({
  event,
}: {
  readonly event: TerminalStateEvent | undefined
}) => {
  if (!event) return null
  const tone = stateColor(event.state)
  return (
    <span
      data-testid="terminal-state-chip"
      title={terminalStateTitle(event)}
      className={`px-1.5 py-0.5 rounded-badge uppercase tracking-wide font-semibold ${tone.bg} ${tone.text}`}
    >
      {tone.label}
    </span>
  )
}
