import { type UseQueryResult, useQuery } from "@tanstack/react-query"
import { type RefObject, useEffect, useRef } from "react"
import { api } from "../../lib/api"
import type { SessionState, TranscriptMessage } from "../../lib/types"
import { SessionBrainstormTab } from "../brainstorms/SessionBrainstormTab"
import { CanvasTab } from "../canvas/CanvasTab"
import { FileTree } from "../projects/FileTree"
import { parseTranscriptResponse } from "../transcripts/loadTranscript"
import { TranscriptView } from "../transcripts/TranscriptView"
import { ChatComposer } from "./ChatComposer"
import { sessionSectionFor } from "./sessionTabs"
import { TerminalTab } from "./TerminalTab"

const Pending = ({ label }: { readonly label: string }) => (
  <div className="px-1 py-4 flex items-center gap-2 text-sm text-base-content/50">
    <span className="loading loading-spinner loading-sm" />
    {label}
  </div>
)

type TranscriptQuery = UseQueryResult<readonly TranscriptMessage[], Error>

const useTranscript = (id: string): TranscriptQuery =>
  useQuery<readonly TranscriptMessage[]>({
    queryKey: ["transcript", id],
    queryFn: async () => {
      // biome-ignore lint/suspicious/noExplicitAny: hc client typing depends on daemon AppType resolution
      const client = api as any
      const res = await client.sessions[":id"].transcript.$get({ param: { id } })
      return parseTranscriptResponse(res)
    },
    // A 404 reads as an empty transcript (session not ready yet). Poll while
    // empty so the chat fills in on its own once the JSONL link is written,
    // rather than waiting for the next SSE state edge to invalidate the query.
    refetchInterval: (q) => (q.state.data && q.state.data.length > 0 ? false : 2_000),
  })

const reason = (err: unknown): string => (err instanceof Error ? err.message : "unknown error")

const TranscriptBody = ({
  query,
  bottomRef,
}: {
  readonly query: TranscriptQuery
  readonly bottomRef: RefObject<HTMLDivElement>
}) => {
  if (query.isLoading) return <Pending label="Loading transcript…" />
  if (query.isError) {
    return (
      <div className="text-sm text-error">Failed to load transcript: {reason(query.error)}</div>
    )
  }
  return (
    <div data-testid="chat-transcript" className="w-full">
      <TranscriptView messages={query.data ?? []} />
      <div ref={bottomRef} />
    </div>
  )
}

const ChatPanel = ({ short }: { readonly short: string }) => {
  const query = useTranscript(short)
  const bottomRef = useRef<HTMLDivElement>(null)
  const messageCount = query.data?.length ?? 0
  // biome-ignore lint/correctness/useExhaustiveDependencies: messageCount triggers scroll on new transcript messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" })
  }, [messageCount])

  return (
    <>
      <div className="flex-1 min-h-0 overflow-y-auto px-1 py-4">
        <TranscriptBody query={query} bottomRef={bottomRef} />
      </div>
      <div className="w-full">
        <ChatComposer short={short} />
      </div>
    </>
  )
}

// Canvas, Brainstorm and Terminal all need the resolved session, so they share
// the not-yet-loaded fallback.
const LivePanel = ({
  tab,
  session,
  onSelectTab,
}: {
  readonly tab: string
  readonly session: SessionState | null | undefined
  readonly onSelectTab: (next: string) => void
}) => {
  if (!session) return <Pending label="Loading session…" />
  if (sessionSectionFor(tab) === "brainstorm") {
    return <SessionBrainstormTab session={session} tab={tab} onSelectTab={onSelectTab} />
  }
  return (
    <div className="flex-1 min-h-0">
      {tab === "canvas" ? (
        <CanvasTab target={{ kind: "session", session }} />
      ) : (
        <TerminalTab session={session} />
      )}
    </div>
  )
}

// The body of whichever section the dock has selected. Returns the panel's own
// flex children directly, so the page column keeps sizing them.
export const SessionPanel = ({
  tab,
  id,
  session,
  onSelectTab,
}: {
  // The raw `?tab=` value: a board arrives as `brainstorm:<encoded path>`.
  readonly tab: string
  readonly id: string
  readonly session: SessionState | null | undefined
  readonly onSelectTab: (next: string) => void
}) => {
  if (tab === "chat") return <ChatPanel short={id} />
  if (tab === "files") {
    return (
      <div className="flex-1 min-h-0 flex flex-col">
        <FileTree resource={{ kind: "sessions", id }} />
      </div>
    )
  }
  return <LivePanel tab={tab} session={session} onSelectTab={onSelectTab} />
}
