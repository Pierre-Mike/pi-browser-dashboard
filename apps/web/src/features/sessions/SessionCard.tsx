import { Link } from "@tanstack/react-router"
import type { ReactNode } from "react"
import { useState } from "react"
import { ageStr, cwdTail, stateColor } from "../../lib/format"
import type { SessionState } from "../../lib/types"
import {
  type TerminalStateEvent,
  terminalStateAddsInfo,
  terminalStateTitle,
} from "../terminal/terminalState"
import { SessionCardActions } from "./SessionCardActions"
import { SessionReplyModal } from "./SessionReplyModal"

type Props = {
  session: SessionState
  // What the session's zellij screen last classified as, from GET
  // /terminal/states — for a session nobody has open, this comes from the
  // unattended poller. Undefined until the daemon has classified it at all.
  terminal?: TerminalStateEvent
}

const SURFACE_CLS =
  "flex flex-col gap-1.5 text-left -m-1 p-1 rounded-btn cursor-pointer hover:bg-base-200 focus:outline-none focus:ring-2 focus:ring-primary"

// The card body, and the one thing on a card that means "go to this session".
// A claude card opens the quick-reply modal (which itself carries an "Open full
// session →" link). A pi run has no supervisor pty to write keys into, so it
// gets no reply modal — and when that was the only handler the body could carry,
// a pi card was *inert*: nothing on it navigated anywhere, and the drill-in was
// reachable only from a sidebar row. So for pi the body is that drill-in link
// directly, same route and params the reply modal's link uses.
const CardBody = ({
  session,
  onReply,
  children,
}: {
  session: SessionState
  // Null for a harness with no quick reply — the body becomes a <Link> instead.
  onReply: (() => void) | null
  children: ReactNode
}) =>
  onReply ? (
    <button
      type="button"
      data-testid="session-card-reply"
      onClick={onReply}
      className={SURFACE_CLS}
    >
      {children}
    </button>
  ) : (
    <Link
      to="/sessions/$id"
      params={{ id: session.short }}
      data-testid="session-card-open"
      title="Open this session"
      className={SURFACE_CLS}
    >
      {children}
    </Link>
  )

export const SessionCard = ({ session, terminal }: Props) => {
  const tone = stateColor(session.state)
  const [replyOpen, setReplyOpen] = useState(false)
  // Only when the screen contradicts the supervisor — otherwise the card would
  // carry two chips saying the same word.
  const screenTone = terminalStateAddsInfo({ sessionState: session.state, terminal })
    ? stateColor(terminal?.state ?? "idle")
    : null
  // The reply modal drives claude's pty (attach → write keys) — a pi run has no
  // supervisor pty to reply into, so its body drills in instead (see CardBody).
  const canReply = session.harness !== "pi"
  // `result` is a free-form, harness-varying payload (`unknown` on the wire) —
  // only preview it when it is actually text.
  const resultText = typeof session.result === "string" ? session.result : null
  const resultPreview =
    session.state === "done" && resultText ? resultText.split("\n")[0]?.slice(0, 140) : null

  return (
    <>
      {/* The card is a plain container, not a <button>: the action controls and
          the SendKeys <textarea> in SessionCardActions are real <button>/
          <textarea> elements and cannot legally nest inside a <button>. Only the
          body is the clickable surface; the action row is its sibling, so action
          clicks never reach it (no stopPropagation hack needed). */}
      <div
        data-testid="session-card"
        data-short={session.short}
        data-state={session.state}
        className={`group rounded-box border border-base-300 bg-base-100 shadow-sm p-3 flex flex-col gap-1.5 ring-1 transition-shadow hover:shadow-md ${tone.ring}`}
      >
        <CardBody session={session} onReply={canReply ? () => setReplyOpen(true) : null}>
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 min-w-0" data-testid="session-card-name">
              <span className={`inline-block w-2 h-2 rounded-full ${tone.dot}`} aria-hidden />
              <span className="font-medium truncate" title={session.name}>
                {session.name || session.short}
              </span>
            </span>
            <span className="flex items-center gap-1">
              {session.harness === "pi" ? (
                <span
                  data-testid="harness-badge"
                  className="badge badge-sm badge-outline badge-secondary font-mono normal-case"
                >
                  pi
                </span>
              ) : null}
              {screenTone && terminal ? (
                <span
                  data-testid="session-card-terminal-state"
                  data-terminal-state={terminal.state}
                  title={`terminal: ${terminalStateTitle(terminal)}`}
                  className={`badge badge-sm badge-outline uppercase tracking-wide font-semibold ${screenTone.text}`}
                >
                  {screenTone.label}
                </span>
              ) : null}
              <span
                className={`badge badge-sm uppercase tracking-wide font-semibold ${tone.bg} ${tone.text}`}
              >
                {tone.label}
              </span>
            </span>
          </div>

          {/* Detail + cwd/age used to be two stacked lines; one row reads just
              as well and halves the height this cluster costs per card. */}
          <div data-testid="session-card-meta" className="flex items-center gap-2 text-sm">
            <span className="truncate flex-1 text-base-content/80" title={session.detail}>
              {session.detail || <span className="text-base-content/60">—</span>}
            </span>
            <span className="shrink-0 whitespace-nowrap text-xs text-base-content/60">
              <span title={session.cwd}>{cwdTail(session.cwd ?? "")}</span>
              <span className="mx-1">·</span>
              <span title={session.updatedAt}>{ageStr(session.updatedAt ?? "")}</span>
            </span>
          </div>

          {resultPreview ? (
            <div className="text-xs text-success truncate" title={resultText ?? undefined}>
              {resultPreview}
            </div>
          ) : null}
        </CardBody>

        <SessionCardActions session={session} />
      </div>
      {replyOpen && canReply ? (
        <SessionReplyModal open session={session} onClose={() => setReplyOpen(false)} />
      ) : null}
    </>
  )
}
