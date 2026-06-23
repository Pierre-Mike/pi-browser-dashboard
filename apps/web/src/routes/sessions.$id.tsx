import { useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { useEffect, useRef, useState } from "react"
import { CanvasTab } from "../features/canvas/CanvasTab"
import { FileTree } from "../features/projects/FileTree"
import { ChatComposer } from "../features/sessions/ChatComposer"
import { TerminalTab } from "../features/sessions/TerminalTab"
import { parseTranscriptResponse } from "../features/transcripts/loadTranscript"
import { TranscriptView } from "../features/transcripts/TranscriptView"
import { api } from "../lib/api"
import { stateColor } from "../lib/format"
import { resolveSessionView } from "../lib/sessionView"
import { coerceEnumTab } from "../lib/tabParams"
import type { SessionState, TranscriptMessage } from "../lib/types"

const SESSION_TABS = ["chat", "canvas", "terminal", "files"] as const
type Tab = (typeof SESSION_TABS)[number]

export const Route = createFileRoute("/sessions/$id")({
  validateSearch: (search: Record<string, unknown>): { tab?: Tab } => {
    const tab = coerceEnumTab(search.tab, SESSION_TABS)
    return tab === undefined ? {} : { tab }
  },
  component: SessionDrillIn,
})

const CONFIRM_TIMEOUT_MS = 3_000

function SessionDrillIn() {
  const { id } = Route.useParams()
  const qc = useQueryClient()

  const sessionQ = useQuery<SessionState | null>({
    queryKey: ["sessions", id],
    queryFn: async () => {
      // biome-ignore lint/suspicious/noExplicitAny: hc client typing depends on daemon AppType resolution
      const client = api as any
      const res = await client.sessions[":id"].$get({ param: { id } })
      if (!res.ok) return null
      return (await res.json()) as SessionState
    },
  })

  const transcriptQ = useQuery<readonly TranscriptMessage[]>({
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

  const [copied, setCopied] = useState(false)
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(`claude attach ${id}`)
      setCopied(true)
      setTimeout(() => setCopied(false), 1_000)
    } catch (err) {
      console.error("clipboard write failed", err)
    }
  }

  const [peeking, setPeeking] = useState(false)
  const [peekSummary, setPeekSummary] = useState<string | null>(null)
  const onPeek = async () => {
    if (peeking) return
    setPeeking(true)
    try {
      // biome-ignore lint/suspicious/noExplicitAny: hc client typing depends on daemon AppType resolution
      const client = api as any
      const res = await client.sessions[":id"].peek.$post({ param: { id } })
      if (!res.ok) throw new Error(`peek: HTTP ${res.status}`)
      const body = (await res.json()) as { summary?: string }
      setPeekSummary(body.summary?.trim() || "(empty)")
    } catch (err) {
      console.error("peek failed", err)
      setPeekSummary("peek failed")
    } finally {
      setPeeking(false)
    }
  }

  const [stopping, setStopping] = useState(false)
  const onStop = async () => {
    if (stopping) return
    setStopping(true)
    try {
      // biome-ignore lint/suspicious/noExplicitAny: hc client typing depends on daemon AppType resolution
      const client = api as any
      await client.sessions[":id"].stop.$post({ param: { id } })
      qc.invalidateQueries({ queryKey: ["sessions"] })
      qc.invalidateQueries({ queryKey: ["sessions", id] })
    } catch (err) {
      console.error("stop failed", err)
    } finally {
      setStopping(false)
    }
  }

  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    return () => {
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current)
    }
  }, [])
  const cancelConfirm = () => {
    if (confirmTimerRef.current) {
      clearTimeout(confirmTimerRef.current)
      confirmTimerRef.current = null
    }
    setConfirmDelete(false)
  }
  const onDelete = async () => {
    if (deleting) return
    if (!confirmDelete) {
      setConfirmDelete(true)
      confirmTimerRef.current = setTimeout(() => setConfirmDelete(false), CONFIRM_TIMEOUT_MS)
      return
    }
    cancelConfirm()
    setDeleting(true)
    try {
      // biome-ignore lint/suspicious/noExplicitAny: hc client typing depends on daemon AppType resolution
      const client = api as any
      const res = await client.sessions[":id"].rm.$post({ param: { id } })
      if (!res.ok) {
        console.error("delete failed", await res.text())
      }
      qc.invalidateQueries({ queryKey: ["sessions"] })
    } catch (err) {
      console.error("delete failed", err)
    } finally {
      setDeleting(false)
    }
  }

  const session = sessionQ.data
  const tone = session ? stateColor(session.state) : null
  const canStop =
    !stopping &&
    session !== null &&
    session !== undefined &&
    session.state !== "stopped" &&
    session.state !== "done"

  const { tab = "terminal" } = Route.useSearch()
  const navigate = Route.useNavigate()
  const setTab = (next: Tab) => navigate({ search: (prev) => ({ ...prev, tab: next }) })

  const bottomRef = useRef<HTMLDivElement>(null)
  const messageCount = transcriptQ.data?.length ?? 0
  // biome-ignore lint/correctness/useExhaustiveDependencies: messageCount triggers scroll on new transcript messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" })
  }, [messageCount])

  // An invalid id (queryFn resolves to null on a 404) must show a not-found
  // state with a back link — never an infinite "Loading session…" with a live
  // action bar wired to a phantom session. Mirrors projects.$id.tsx.
  if (resolveSessionView({ isLoading: sessionQ.isLoading, data: session }) === "not-found") {
    return (
      <div className="flex flex-col gap-2">
        <Link to="/" className="btn btn-sm btn-ghost normal-case text-xs">
          ← All sessions
        </Link>
        <div data-testid="session-not-found" className="text-sm text-slate-600 dark:text-slate-400">
          Session <span className="font-mono">{id}</span> not found.
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-screen -my-4">
      <header className="flex flex-wrap items-center gap-3 px-1 py-3 border-b border-slate-200/80 dark:border-slate-800 bg-base-100">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="text-base font-semibold truncate" title={session?.name ?? id}>
              {session?.name ?? id}
            </h1>
            {session && tone ? (
              <span
                className={`badge badge-sm uppercase tracking-wide font-semibold ${tone.bg} ${tone.text}`}
              >
                {tone.label}
              </span>
            ) : null}
          </div>
          {session ? (
            <div className="text-[11px] text-base-content/50 flex flex-wrap gap-x-2 mt-0.5">
              <span className="font-mono">{session.short}</span>
              <span title={session.cwd} className="truncate">
                {session.cwd}
              </span>
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <button type="button" onClick={onCopy} className="btn btn-xs btn-ghost normal-case">
            {copied ? "Copied" : "Open in CLI ↗"}
          </button>
          <button
            type="button"
            data-testid="peek"
            onClick={onPeek}
            disabled={peeking}
            className="btn btn-xs btn-ghost normal-case disabled:opacity-40"
            title="Trigger a fresh Haiku peek (costs one call against your quota)"
          >
            {peeking ? <span className="loading loading-spinner loading-xs" /> : null}
            {peeking ? "Peeking…" : "Peek"}
          </button>
          <button
            type="button"
            data-testid="stop"
            onClick={onStop}
            disabled={!canStop}
            className="btn btn-xs normal-case border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-900/50 disabled:opacity-30 disabled:bg-transparent disabled:border-slate-300 disabled:dark:border-slate-700 disabled:text-slate-500"
            title="claude stop — process exits, registry keeps the entry (claude respawn to recover)"
          >
            {stopping ? <span className="loading loading-spinner loading-xs" /> : null}
            {stopping ? "Stopping…" : "Kill"}
          </button>
          <button
            type="button"
            data-testid="delete"
            onClick={onDelete}
            onBlur={cancelConfirm}
            disabled={deleting}
            className={`btn btn-xs normal-case disabled:opacity-30 ${
              confirmDelete
                ? "border-rose-500 bg-rose-500 text-white hover:bg-rose-600 dark:hover:bg-rose-400"
                : "border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-200 hover:bg-rose-100 dark:hover:bg-rose-900/50"
            }`}
            title="claude rm — remove session entirely; worktree cleaned if no uncommitted changes"
          >
            {deleting ? <span className="loading loading-spinner loading-xs" /> : null}
            {deleting ? "Deleting…" : confirmDelete ? "Confirm?" : "Delete"}
          </button>
        </div>
      </header>
      {peekSummary ? (
        <div
          data-testid="peek-summary"
          className="mx-1 mt-2 rounded-lg border border-slate-200/80 dark:border-slate-800 bg-base-200 p-2 text-xs text-base-content/80 whitespace-pre-wrap"
        >
          {peekSummary}
        </div>
      ) : null}

      <div className="flex gap-1 border-b border-slate-200/80 dark:border-slate-800 px-1 bg-base-100">
        {(["terminal", "chat", "canvas"] as const).map((t) => (
          <button
            key={t}
            type="button"
            data-testid={`tab-${t}`}
            data-active={tab === t ? "true" : "false"}
            onClick={() => setTab(t)}
            className={`px-3 py-1.5 text-xs font-medium border-b-2 -mb-px capitalize ${
              tab === t
                ? "border-primary text-primary"
                : "border-transparent text-base-content/50 hover:text-base-content"
            }`}
          >
            {t}
          </button>
        ))}
        <button
          type="button"
          data-testid="tab-files"
          data-active={tab === "files" ? "true" : "false"}
          onClick={() => setTab("files")}
          className={`px-3 py-1.5 text-xs font-medium border-b-2 -mb-px capitalize ${
            tab === "files"
              ? "border-primary text-primary"
              : "border-transparent text-base-content/50 hover:text-base-content"
          }`}
        >
          files
        </button>
      </div>

      {tab === "chat" ? (
        <>
          <div className="flex-1 min-h-0 overflow-y-auto px-1 py-4">
            {transcriptQ.isLoading ? (
              <div className="flex items-center gap-2 text-sm text-base-content/50">
                <span className="loading loading-spinner loading-sm" />
                Loading transcript…
              </div>
            ) : transcriptQ.isError ? (
              <div className="text-sm text-error">
                Failed to load transcript:{" "}
                {transcriptQ.error instanceof Error ? transcriptQ.error.message : "unknown error"}
              </div>
            ) : (
              <div data-testid="chat-transcript" className="w-full">
                <TranscriptView messages={transcriptQ.data ?? []} />
                <div ref={bottomRef} />
              </div>
            )}
          </div>

          <div className="w-full">
            <ChatComposer short={id} />
          </div>
        </>
      ) : tab === "canvas" ? (
        session ? (
          <div className="flex-1 min-h-0">
            <CanvasTab session={session} />
          </div>
        ) : (
          <div className="px-1 py-4 flex items-center gap-2 text-sm text-base-content/50">
            <span className="loading loading-spinner loading-sm" />
            Loading session…
          </div>
        )
      ) : tab === "files" ? (
        <div className="flex-1 min-h-0 flex flex-col">
          <FileTree resource={{ kind: "sessions", id }} />
        </div>
      ) : session ? (
        <div className="flex-1 min-h-0">
          <TerminalTab session={session} />
        </div>
      ) : (
        <div className="px-1 py-4 flex items-center gap-2 text-sm text-base-content/50">
          <span className="loading loading-spinner loading-sm" />
          Loading session…
        </div>
      )}
    </div>
  )
}
