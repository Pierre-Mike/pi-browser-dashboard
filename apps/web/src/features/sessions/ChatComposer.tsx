import { useQueryClient } from "@tanstack/react-query"
import { useEffect, useRef, useState } from "react"
import { api } from "../../lib/api"
import { appendPath } from "../uploads/appendPath"
import { subscribeDroppedPaths } from "../uploads/dropEvents"

type Props = { short: string; disabled?: boolean }

const SEND_HARD_TIMEOUT_MS = 20_000

export const ChatComposer = ({ short, disabled }: Props) => {
  const qc = useQueryClient()
  const [text, setText] = useState("")
  const [inFlight, setInFlight] = useState(0)
  const [status, setStatus] = useState<string | null>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    return subscribeDroppedPaths((path) => {
      setText((prev) => appendPath(prev, path))
    })
  }, [])

  const send = async () => {
    const trimmed = text.trim()
    if (trimmed.length === 0) return
    const keys = trimmed.endsWith("\r") || trimmed.endsWith("\n") ? trimmed : `${trimmed}\r`
    // Optimistic clear so the user can keep typing while the pty round-trip runs.
    setText("")
    setStatus("sending…")
    setInFlight((n) => n + 1)
    taRef.current?.focus()

    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), SEND_HARD_TIMEOUT_MS)
    try {
      // biome-ignore lint/suspicious/noExplicitAny: hc client typing depends on daemon AppType resolution
      const client = api as any
      const res = await client.sessions[":id"].send.$post(
        { param: { id: short }, json: { keys } },
        { init: { signal: ac.signal } },
      )
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        setStatus(`failed: ${body.error ?? `HTTP ${res.status}`}`)
        return
      }
      setStatus("sent")
      qc.invalidateQueries({ queryKey: ["transcript", short] })
      qc.invalidateQueries({ queryKey: ["sessions", short] })
    } catch (err) {
      const msg =
        err instanceof DOMException && err.name === "AbortError"
          ? "timed out (>20s)"
          : err instanceof Error
            ? err.message
            : "unknown"
      setStatus(`failed: ${msg}`)
    } finally {
      clearTimeout(timer)
      setInFlight((n) => Math.max(0, n - 1))
      setTimeout(() => setStatus(null), 2_500)
    }
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      void send()
    }
  }

  const sending = inFlight > 0

  return (
    <div data-testid="chat-composer" className="pt-2 pb-4 px-1">
      <div className="relative rounded-2xl border border-base-300 bg-base-100 shadow-sm focus-within:ring-2 focus-within:ring-primary focus-within:border-primary transition-shadow">
        <textarea
          ref={taRef}
          data-testid="chat-textarea"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={disabled}
          placeholder="Message the session…"
          rows={1}
          className="block w-full resize-none rounded-2xl bg-transparent px-4 pt-3 pb-12 text-sm focus:outline-none disabled:opacity-50 max-h-48 overflow-y-auto"
          style={{ minHeight: "3.25rem" }}
        />
        <div className="absolute bottom-2 left-3 right-3 flex items-end justify-between gap-2 pointer-events-none">
          <span className="text-[10px] text-base-content/60 pointer-events-auto select-none">
            Enter to send · Shift+Enter newline
          </span>
          <button
            type="button"
            data-testid="chat-send"
            onClick={() => void send()}
            disabled={disabled || text.trim().length === 0}
            className="pointer-events-auto rounded-full bg-primary hover:bg-primary/90 text-primary-content text-xs font-semibold px-3.5 py-1.5 disabled:opacity-40 disabled:cursor-not-allowed shadow-sm flex items-center gap-1.5"
            title="Send (Enter)"
          >
            <span>Send</span>
            {sending ? (
              <span className="text-[10px] tabular-nums">({inFlight})</span>
            ) : (
              <span aria-hidden>↵</span>
            )}
          </button>
        </div>
      </div>
      {status ? (
        <div
          data-testid="chat-status"
          className={`mt-1 px-2 text-[11px] font-mono ${
            status.startsWith("failed") ? "text-error" : "text-success"
          }`}
        >
          {status}
        </div>
      ) : null}
    </div>
  )
}
