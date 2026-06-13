import { useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { useEffect, useRef, useState } from "react"
import { CanvasTab } from "../features/canvas/CanvasTab"
import { ChatComposer } from "../features/sessions/ChatComposer"
import { FilesTab, useSessionFiles } from "../features/sessions/FilesTab"
import { TerminalTab } from "../features/sessions/TerminalTab"
import { TranscriptView } from "../features/transcripts/TranscriptView"
import { api } from "../lib/api"
import { stateColor } from "../lib/format"
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
      if (!res.ok) throw new Error(`transcript: HTTP ${res.status}`)
      const body = (await res.json()) as TranscriptMessage[] | { messages: TranscriptMessage[] }
      if (Array.isArray(body)) return body
      return body.messages ?? []
    },
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

  const filesQ = useSessionFiles(id)
  const filesChanged = filesQ.data?.changed === true
  const fileCount = filesQ.data?.files.length ?? 0

  // Refetch the diff when the session state changes — `session.state` SSE
  // events flow through queryClient.setQueryData(["sessions", id], …), so
  // observing that cache version is enough without coupling to the SSE bus.
  const sessionVersion = session?.updatedAt
  useEffect(() => {
    if (sessionVersion) filesQ.refetch()
  }, [sessionVersion, filesQ.refetch])

  // If the tab was on `files` and the changes disappeared, drop back to terminal.
  useEffect(() => {
    if (tab === "files" && !filesChanged)
      navigate({ search: (prev) => ({ ...prev, tab: "terminal" }), replace: true })
  }, [tab, filesChanged, navigate])

  const bottomRef = useRef<HTMLDivElement>(null)
  const messageCount = transcriptQ.data?.length ?? 0
  // biome-ignore lint/correctness/useExhaustiveDependencies: messageCount triggers scroll on new transcript messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" })
  }, [messageCount])

  return (
    <div className="flex flex-col h-screen -my-4">
      <header className="flex flex-wrap items-center gap-3 px-1 py-3 border-b border-slate-200 dark:border-slate-800">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="text-base font-semibold truncate" title={session?.name ?? id}>
              {session?.name ?? id}
            </h1>
            {session && tone ? (
              <span
                className={`text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded ${tone.bg} ${tone.text}`}
              >
                {tone.label}
              </span>
            ) : null}
          </div>
          {session ? (
            <div className="text-[11px] text-slate-500 dark:text-slate-400 flex flex-wrap gap-x-2 mt-0.5">
              <span className="font-mono">{session.short}</span>
              <span title={session.cwd} className="truncate">
                {session.cwd}
              </span>
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            type="button"
            onClick={onCopy}
            className="text-xs rounded border border-slate-300 dark:border-slate-700 px-2 py-0.5 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            {copied ? "Copied" : "Open in CLI ↗"}
          </button>
          <button
            type="button"
            data-testid="peek"
            onClick={onPeek}
            disabled={peeking}
            className="text-xs rounded border border-slate-300 dark:border-slate-700 px-2 py-0.5 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed"
            title="Trigger a fresh Haiku peek (costs one call against your quota)"
          >
            {peeking ? "Peeking…" : "Peek"}
          </button>
          <button
            type="button"
            data-testid="stop"
            onClick={onStop}
            disabled={!canStop}
            className="text-xs font-medium rounded border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-200 px-2 py-0.5 hover:bg-amber-100 dark:hover:bg-amber-900/50 disabled:opacity-30 disabled:cursor-not-allowed disabled:bg-transparent disabled:border-slate-300 disabled:dark:border-slate-700 disabled:text-slate-500"
            title="claude stop — process exits, registry keeps the entry (claude respawn to recover)"
          >
            {stopping ? "Stopping…" : "Kill"}
          </button>
          <button
            type="button"
            data-testid="delete"
            onClick={onDelete}
            onBlur={cancelConfirm}
            disabled={deleting}
            className={`text-xs font-medium rounded border px-2 py-0.5 disabled:opacity-30 disabled:cursor-not-allowed ${
              confirmDelete
                ? "border-rose-500 bg-rose-500 text-white hover:bg-rose-600 dark:hover:bg-rose-400"
                : "border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-200 hover:bg-rose-100 dark:hover:bg-rose-900/50"
            }`}
            title="claude rm — remove session entirely; worktree cleaned if no uncommitted changes"
          >
            {deleting ? "Deleting…" : confirmDelete ? "Confirm?" : "Delete"}
          </button>
        </div>
      </header>
      {peekSummary ? (
        <div
          data-testid="peek-summary"
          className="mx-1 mt-2 rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/40 p-2 text-xs text-slate-700 dark:text-slate-300 whitespace-pre-wrap"
        >
          {peekSummary}
        </div>
      ) : null}

      <div className="flex gap-1 border-b border-slate-200 dark:border-slate-800 px-1">
        {(["terminal", "chat", "canvas"] as const).map((t) => (
          <button
            key={t}
            type="button"
            data-testid={`tab-${t}`}
            data-active={tab === t ? "true" : "false"}
            onClick={() => setTab(t)}
            className={`px-3 py-1.5 text-xs font-medium border-b-2 -mb-px capitalize ${
              tab === t
                ? "border-sky-500 text-sky-700 dark:text-sky-300"
                : "border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
            }`}
          >
            {t}
          </button>
        ))}
        {filesChanged ? (
          <button
            type="button"
            data-testid="tab-files"
            data-active={tab === "files" ? "true" : "false"}
            onClick={() => setTab("files")}
            className={`px-3 py-1.5 text-xs font-medium border-b-2 -mb-px ${
              tab === "files"
                ? "border-sky-500 text-sky-700 dark:text-sky-300"
                : "border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
            }`}
            title="View the diff of files changed in this session's worktree"
          >
            Files
            <span className="ml-1.5 inline-flex items-center justify-center min-w-[1.25rem] px-1 rounded-full bg-slate-200 dark:bg-slate-700 text-[10px] font-mono">
              {fileCount}
            </span>
          </button>
        ) : null}
      </div>

      {tab === "chat" ? (
        <>
          <div className="flex-1 min-h-0 overflow-y-auto px-1 py-4">
            {transcriptQ.isLoading ? (
              <div className="text-sm text-slate-500">Loading transcript…</div>
            ) : transcriptQ.isError ? (
              <div className="text-sm text-rose-600">
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
          <div className="px-1 py-4 text-sm text-slate-500">Loading session…</div>
        )
      ) : tab === "files" ? (
        <div className="flex-1 min-h-0 flex flex-col">
          <FilesTab short={id} />
        </div>
      ) : session ? (
        <div className="flex-1 min-h-0">
          <TerminalTab session={session} />
        </div>
      ) : (
        <div className="px-1 py-4 text-sm text-slate-500">Loading session…</div>
      )}
    </div>
  )
}
