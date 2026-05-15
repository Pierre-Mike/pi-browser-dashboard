import { useQueryClient } from "@tanstack/react-query"
import { Link, useNavigate } from "@tanstack/react-router"
import { useEffect, useRef, useState } from "react"
import { api } from "../../lib/api"
import { ageStr, cwdTail, stateColor } from "../../lib/format"
import type { SessionState } from "../../lib/types"
import { SendKeysPanel } from "./SendKeysPanel"

type Props = { session: SessionState }

const copy = async (text: string): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch (err) {
    console.error("clipboard write failed", err)
    return false
  }
}

const CONFIRM_TIMEOUT_MS = 3_000

export const SessionCard = ({ session }: Props) => {
  const tone = stateColor(session.state)
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [copied, setCopied] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [peeking, setPeeking] = useState(false)
  const [peekSummary, setPeekSummary] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [sendOpen, setSendOpen] = useState(session.state === "needs_input")
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current)
    }
  }, [])

  const onCopy = async () => {
    const ok = await copy(`claude attach ${session.short}`)
    if (!ok) return
    setCopied(true)
    setTimeout(() => setCopied(false), 1_000)
  }

  const onPeek = async () => {
    if (peeking) return
    setPeeking(true)
    try {
      // biome-ignore lint/suspicious/noExplicitAny: hc client typing depends on daemon AppType resolution
      const client = api as any
      const res = await client.sessions[":id"].peek.$post({ param: { id: session.short } })
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

  const onStop = async () => {
    if (stopping) return
    setStopping(true)
    try {
      // biome-ignore lint/suspicious/noExplicitAny: hc client typing depends on daemon AppType resolution
      const client = api as any
      await client.sessions[":id"].stop.$post({ param: { id: session.short } })
      qc.invalidateQueries({ queryKey: ["sessions"] })
    } catch (err) {
      console.error("stop failed", err)
    } finally {
      setStopping(false)
    }
  }

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
      const res = await client.sessions[":id"].rm.$post({ param: { id: session.short } })
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

  const canStop = !stopping && session.state !== "stopped" && session.state !== "done"

  const resultPreview =
    session.state === "done" && session.result ? session.result.split("\n")[0]?.slice(0, 140) : null

  const openDrillIn = () => {
    void navigate({ to: "/sessions/$id", params: { id: session.short } })
  }

  const stop = (ev: React.MouseEvent | React.KeyboardEvent) => {
    ev.stopPropagation()
  }

  return (
    <div
      data-testid="session-card"
      data-short={session.short}
      data-state={session.state}
      onClick={openDrillIn}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          openDrillIn()
        }
      }}
      role="button"
      tabIndex={0}
      className={`rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm p-3 flex flex-col gap-1.5 ring-1 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50 focus:outline-none focus:ring-2 focus:ring-sky-400 ${tone.ring}`}
    >
      <div className="flex items-center justify-between gap-2">
        <Link
          to="/sessions/$id"
          params={{ id: session.short }}
          onClick={stop}
          className="flex items-center gap-2 min-w-0 hover:underline"
        >
          <span className={`inline-block w-2 h-2 rounded-full ${tone.dot}`} aria-hidden />
          <span className="font-medium truncate" title={session.name}>
            {session.name || session.short}
          </span>
        </Link>
        <span
          className={`text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded ${tone.bg} ${tone.text}`}
        >
          {tone.label}
        </span>
      </div>

      <div className="text-sm text-slate-700 dark:text-slate-300 truncate" title={session.detail}>
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

      <div className="flex items-center gap-1.5 pt-1" onClick={stop} onKeyDown={stop}>
        <button
          type="button"
          onClick={onCopy}
          className="text-xs rounded border border-slate-300 dark:border-slate-700 px-2 py-0.5 hover:bg-slate-100 dark:hover:bg-slate-800"
          title={`Copy: claude attach ${session.short}`}
        >
          {copied ? "Copied" : "Open ↗"}
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
          data-testid="send-toggle"
          onClick={() => setSendOpen((v) => !v)}
          className={`text-xs rounded border px-2 py-0.5 ${
            sendOpen
              ? "border-sky-400 dark:border-sky-700 bg-sky-50 dark:bg-sky-950/40 text-sky-800 dark:text-sky-200"
              : "border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
          }`}
          title="Pty-attach and inject keys (claude attach → write → detach)"
        >
          {sendOpen ? "Send ▾" : "Send ▸"}
        </button>
        <span className="ml-auto flex items-center gap-1.5">
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
        </span>
        <span className="text-[10px] font-mono text-slate-400 pl-1">{session.short}</span>
      </div>

      {peekSummary ? (
        <div
          data-testid="peek-summary"
          className="mt-1 rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/40 p-2 text-xs text-slate-700 dark:text-slate-300 whitespace-pre-wrap"
        >
          {peekSummary}
        </div>
      ) : null}

      {sendOpen ? (
        <div onClick={stop} onKeyDown={stop}>
          <SendKeysPanel short={session.short} />
        </div>
      ) : null}
    </div>
  )
}
