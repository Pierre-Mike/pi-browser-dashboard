import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { api } from "../../lib/api"
import { ageStr, cwdTail, stateColor } from "../../lib/format"
import type { SessionState, TranscriptMessage } from "../../lib/types"
import { Modal } from "../library/dialogs/Modal"
import { ChatComposer } from "./ChatComposer"
import { type LastMessage, resolveLastMessage } from "./lastMessage"

type Props = { open: boolean; session: SessionState; onClose: () => void }

const roleLabel: Record<LastMessage["role"], string> = {
  assistant: "Assistant",
  user: "You",
  result: "Result",
}

const fetchTranscript = async (short: string): Promise<readonly TranscriptMessage[]> => {
  // biome-ignore lint/suspicious/noExplicitAny: hc client typing depends on daemon AppType resolution
  const client = api as any
  const res = await client.sessions[":id"].transcript.$get({ param: { id: short } })
  if (!res.ok) throw new Error(`transcript: HTTP ${res.status}`)
  const body = (await res.json()) as TranscriptMessage[] | { messages: TranscriptMessage[] }
  return Array.isArray(body) ? body : (body.messages ?? [])
}

const MessageBody = ({ message, loading }: { message: LastMessage | null; loading: boolean }) => {
  if (message) {
    return (
      <>
        <span className="text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500">
          {roleLabel[message.role]}
        </span>
        <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/40 p-3 text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap max-h-72 overflow-y-auto">
          {message.text}
        </div>
      </>
    )
  }
  const note = loading ? "Loading last message…" : "No messages yet."
  return <div className="text-sm text-slate-400 dark:text-slate-500">{note}</div>
}

// Quick-reply surface for a session: show its most recent message and let the
// user answer it inline (PTY send via ChatComposer) — no full drill-in needed.
// Message resolution (transcript vs registry fallback) lives in lastMessage.ts.
export const SessionReplyModal = ({ open, session, onClose }: Props) => {
  const tone = stateColor(session.state)
  const short = session.short

  const transcriptQ = useQuery<readonly TranscriptMessage[]>({
    queryKey: ["transcript", short],
    enabled: open,
    queryFn: () => fetchTranscript(short),
  })

  const message = resolveLastMessage({ transcript: transcriptQ.data, session })

  return (
    <Modal open={open} onClose={onClose} title={session.name || short} testId="session-reply-modal">
      <div className="flex items-center justify-between gap-2">
        <span
          className={`text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded ${tone.bg} ${tone.text}`}
        >
          {tone.label}
        </span>
        <span className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
          <span title={session.cwd}>{cwdTail(session.cwd)}</span>
          <span className="mx-1">·</span>
          <span title={session.updatedAt}>{ageStr(session.updatedAt)}</span>
        </span>
      </div>

      <div data-testid="reply-last-message" className="flex flex-col gap-1">
        <MessageBody message={message} loading={transcriptQ.isLoading} />
      </div>

      <ChatComposer short={short} />

      <Link
        to="/sessions/$id"
        params={{ id: short }}
        data-testid="reply-open-full"
        onClick={onClose}
        className="text-xs text-sky-700 dark:text-sky-300 hover:underline self-start"
      >
        Open full session →
      </Link>
    </Modal>
  )
}
