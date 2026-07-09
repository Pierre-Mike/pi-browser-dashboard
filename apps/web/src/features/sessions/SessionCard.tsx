import { useState } from "react"
import { ageStr, cwdTail, stateColor } from "../../lib/format"
import type { SessionState } from "../../lib/types"
import { SessionCardActions } from "./SessionCardActions"
import { SessionReplyModal } from "./SessionReplyModal"

type Props = { session: SessionState }

const SURFACE_CLS =
  "flex flex-col gap-1.5 text-left -m-1 p-1 rounded cursor-pointer hover:bg-base-200 focus:outline-none focus:ring-2 focus:ring-primary"

export const SessionCard = ({ session }: Props) => {
  const tone = stateColor(session.state)
  const [replyOpen, setReplyOpen] = useState(false)
  // The reply modal drives claude's pty (attach → write keys) — a pi run has
  // no supervisor pty to reply into, so its surface stays inert.
  const canReply = session.harness !== "pi"
  const resultPreview =
    session.state === "done" && session.result ? session.result.split("\n")[0]?.slice(0, 140) : null

  return (
    <>
      {/* The card is a plain container, not a <button>: the action controls and
          the SendKeys <textarea> in SessionCardActions are real <button>/
          <textarea> elements and cannot legally nest inside a <button>. Only the
          content surface is the clickable "open reply" button; the action row is
          its sibling, so action clicks never reach openReply (no stopPropagation
          hack needed). */}
      <div
        data-testid="session-card"
        data-short={session.short}
        data-state={session.state}
        className={`rounded-lg border border-base-300 bg-base-100 shadow-sm p-3 flex flex-col gap-1.5 ring-1 transition-shadow hover:shadow-md ${tone.ring}`}
      >
        <button
          type="button"
          onClick={canReply ? () => setReplyOpen(true) : undefined}
          className={canReply ? SURFACE_CLS : `${SURFACE_CLS} cursor-default`}
        >
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
              <span
                className={`badge badge-sm uppercase tracking-wide font-semibold ${tone.bg} ${tone.text}`}
              >
                {tone.label}
              </span>
            </span>
          </div>

          <div className="text-sm text-base-content/80 truncate" title={session.detail}>
            {session.detail || <span className="text-base-content/60">—</span>}
          </div>

          {resultPreview ? (
            <div className="text-xs text-success truncate" title={session.result}>
              {resultPreview}
            </div>
          ) : null}

          <div className="text-xs text-base-content/60 truncate">
            <span title={session.cwd}>{cwdTail(session.cwd)}</span>
            <span className="mx-1">·</span>
            <span title={session.updatedAt}>{ageStr(session.updatedAt)}</span>
          </div>
        </button>

        <SessionCardActions session={session} />
      </div>
      {replyOpen && canReply ? (
        <SessionReplyModal open session={session} onClose={() => setReplyOpen(false)} />
      ) : null}
    </>
  )
}
