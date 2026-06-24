import { useQueryClient } from "@tanstack/react-query"
import { useEffect, useRef, useState } from "react"
import { api } from "../../lib/api"
import type { SessionState } from "../../lib/types"
import { SendKeysPanel } from "./SendKeysPanel"

const CONFIRM_TIMEOUT_MS = 3_000

const copy = async (text: string): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch (err) {
    console.error("clipboard write failed", err)
    return false
  }
}

const post = (path: "stop" | "rm" | "peek", id: string): Promise<Response> =>
  // biome-ignore lint/suspicious/noExplicitAny: hc client typing depends on daemon AppType resolution
  (api as any).sessions[":id"][path].$post({ param: { id } })

// Owns the per-card action state and the daemon calls behind each button. Kept
// out of SessionCard so the card stays a thin presentational shell.
const useSessionCardActions = (session: SessionState) => {
  const qc = useQueryClient()
  const [copied, setCopied] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [peeking, setPeeking] = useState(false)
  const [peekSummary, setPeekSummary] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [sendOpen, setSendOpen] = useState(session.state === "needs_input")
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => clearTimeout(confirmTimerRef.current ?? undefined), [])

  const onCopy = async () => {
    if (await copy(`claude attach ${session.short}`)) {
      setCopied(true)
      setTimeout(() => setCopied(false), 1_000)
    }
  }

  const onPeek = async () => {
    if (peeking) return
    setPeeking(true)
    try {
      const res = await post("peek", session.short)
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
      await post("stop", session.short)
      qc.invalidateQueries({ queryKey: ["sessions"] })
    } catch (err) {
      console.error("stop failed", err)
    } finally {
      setStopping(false)
    }
  }

  const cancelConfirm = () => {
    clearTimeout(confirmTimerRef.current ?? undefined)
    confirmTimerRef.current = null
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
      const res = await post("rm", session.short)
      if (!res.ok) console.error("delete failed", await res.text())
      qc.invalidateQueries({ queryKey: ["sessions"] })
    } catch (err) {
      console.error("delete failed", err)
    } finally {
      setDeleting(false)
    }
  }

  const canStop = !stopping && session.state !== "stopped" && session.state !== "done"

  return {
    copied,
    peeking,
    peekSummary,
    stopping,
    deleting,
    confirmDelete,
    sendOpen,
    canStop,
    setSendOpen,
    onCopy,
    onPeek,
    onStop,
    onDelete,
    cancelConfirm,
  }
}

// Sibling of the card's open-reply surface (not a descendant of it) so these
// real <button>/<textarea> controls never nest inside a <button>.
export const SessionCardActions = ({ session }: { session: SessionState }) => {
  const a = useSessionCardActions(session)
  return (
    <>
      <div className="flex items-center gap-1.5 pt-1">
        <button
          type="button"
          onClick={a.onCopy}
          className="btn btn-xs btn-ghost normal-case"
          title={`Copy: claude attach ${session.short}`}
        >
          {a.copied ? "Copied" : "Open ↗"}
        </button>
        <button
          type="button"
          data-testid="peek"
          onClick={a.onPeek}
          disabled={a.peeking}
          className="btn btn-xs btn-ghost normal-case disabled:opacity-40"
          title="Trigger a fresh Haiku peek (costs one call against your quota)"
        >
          {a.peeking ? (
            <>
              <span className="loading loading-spinner loading-xs" />
              Peeking…
            </>
          ) : (
            "Peek"
          )}
        </button>
        <button
          type="button"
          data-testid="send-toggle"
          onClick={() => a.setSendOpen((v) => !v)}
          className={
            a.sendOpen
              ? "btn btn-xs btn-primary normal-case shadow-sm shadow-primary/30"
              : "btn btn-xs btn-ghost normal-case"
          }
          title="Pty-attach and inject keys (claude attach → write → detach)"
        >
          {a.sendOpen ? "Send ▾" : "Send ▸"}
        </button>
        <span className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            data-testid="stop"
            onClick={a.onStop}
            disabled={!a.canStop}
            className="btn btn-xs btn-warning normal-case disabled:opacity-30"
            title="claude stop — process exits, registry keeps the entry (claude respawn to recover)"
          >
            {a.stopping ? "Stopping…" : "Kill"}
          </button>
          <button
            type="button"
            data-testid="delete"
            onClick={a.onDelete}
            onBlur={a.cancelConfirm}
            disabled={a.deleting}
            className={
              a.confirmDelete
                ? "btn btn-xs btn-error normal-case disabled:opacity-30"
                : "btn btn-xs btn-outline btn-error normal-case disabled:opacity-30"
            }
            title="claude rm — remove session entirely; worktree cleaned if no uncommitted changes"
          >
            {a.deleting ? "Deleting…" : a.confirmDelete ? "Confirm?" : "Delete"}
          </button>
        </span>
        <span className="text-[10px] font-mono text-base-content/40 pl-1">{session.short}</span>
      </div>

      {a.peekSummary ? (
        <div
          data-testid="peek-summary"
          className="mt-1 rounded-lg border border-base-300 bg-base-200 p-2 text-xs text-base-content whitespace-pre-wrap"
        >
          {a.peekSummary}
        </div>
      ) : null}

      {a.sendOpen ? <SendKeysPanel short={session.short} /> : null}
    </>
  )
}
