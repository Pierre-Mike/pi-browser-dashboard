import { useState } from "react"
import { ageStr, cwdTail, stateColor } from "../../lib/format"
import type { SessionState } from "../../lib/types"
import { SessionCardActions } from "./SessionCardActions"
import { SessionReplyModal } from "./SessionReplyModal"

type Props = { session: SessionState }

const SURFACE_CLS =
  "flex flex-col gap-1.5 text-left -m-1 p-1 rounded cursor-pointer hover:bg-base-200 focus:outline-none focus:ring-2 focus:ring-sky-400"

export const SessionCard = ({ session }: Props) => {
  const tone = stateColor(session.state)
  const [replyOpen, setReplyOpen] = useState(false)
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
        className={`rounded-lg border border-slate-200/80 dark:border-slate-800 bg-base-100 shadow-sm p-3 flex flex-col gap-1.5 ring-1 transition-shadow hover:shadow-md ${tone.ring}`}
      >
        <button type="button" onClick={() => setReplyOpen(true)} className={SURFACE_CLS}>
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 min-w-0" data-testid="session-card-name">
              <span className={`inline-block w-2 h-2 rounded-full ${tone.dot}`} aria-hidden />
              <span className="font-medium truncate" title={session.name}>
                {session.name || session.short}
              </span>
            </span>
            <span
              className={`badge badge-sm uppercase tracking-wide font-semibold ${tone.bg} ${tone.text}`}
            >
              {tone.label}
            </span>
          </div>

          <div
            className="text-sm text-slate-700 dark:text-slate-300 truncate"
            title={session.detail}
          >
            {session.detail || <span className="text-slate-400">—</span>}
          </div>

          {resultPreview ? (
            <div
              className="text-xs text-emerald-700 dark:text-emerald-300 truncate"
              title={session.result}
            >
              {resultPreview}
            </div>
          ) : null}

          <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
            <span title={session.cwd}>{cwdTail(session.cwd)}</span>
            <span className="mx-1">·</span>
            <span title={session.updatedAt}>{ageStr(session.updatedAt)}</span>
          </div>
        </button>

        <SessionCardActions session={session} />
      </div>
      {replyOpen ? (
        <SessionReplyModal open session={session} onClose={() => setReplyOpen(false)} />
      ) : null}
    </>
  )
}
