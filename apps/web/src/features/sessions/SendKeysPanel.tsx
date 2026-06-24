import { useQueryClient } from "@tanstack/react-query"
import { useRef, useState } from "react"
import { api } from "../../lib/api"

type Props = { short: string }

const PRESETS: ReadonlyArray<{ label: string; keys: string; title: string }> = [
  { label: "y", keys: "y\r", title: "yes + enter" },
  { label: "n", keys: "n\r", title: "no + enter" },
  { label: "1", keys: "1\r", title: "option 1" },
  { label: "2", keys: "2\r", title: "option 2" },
  { label: "3", keys: "3\r", title: "option 3" },
  { label: "⏎", keys: "\r", title: "enter" },
  { label: "Esc", keys: "", title: "escape" },
]

export const SendKeysPanel = ({ short }: Props) => {
  const qc = useQueryClient()
  const [sending, setSending] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [freeForm, setFreeForm] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  const send = async (keys: string) => {
    if (sending || keys.length === 0) return
    setSending(true)
    setStatus(null)
    try {
      // biome-ignore lint/suspicious/noExplicitAny: hc client typing depends on daemon AppType resolution
      const client = api as any
      const res = await client.sessions[":id"].send.$post({
        param: { id: short },
        json: { keys },
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        setStatus(`failed: ${body.error ?? `HTTP ${res.status}`}`)
      } else {
        setStatus(`sent ${JSON.stringify(keys)}`)
        qc.invalidateQueries({ queryKey: ["sessions"] })
      }
    } catch (err) {
      setStatus(`failed: ${err instanceof Error ? err.message : "unknown"}`)
    } finally {
      setSending(false)
      setTimeout(() => setStatus(null), 2_500)
    }
  }

  const onSubmitFreeform = (ev: React.FormEvent) => {
    ev.preventDefault()
    if (!freeForm) return
    void send(freeForm.endsWith("\r") || freeForm.endsWith("\n") ? freeForm : `${freeForm}\r`)
    setFreeForm("")
    inputRef.current?.focus()
  }

  return (
    <div
      data-testid="send-panel"
      className="mt-1 rounded border border-base-300 bg-base-200 p-2 flex flex-col gap-1.5"
    >
      <div className="flex items-center gap-1 flex-wrap">
        <span className="text-[10px] uppercase tracking-wide text-base-content/60 mr-1">
          Send keys
        </span>
        {PRESETS.map((p) => (
          <button
            type="button"
            key={p.label}
            data-testid={`send-preset-${p.label}`}
            onClick={() => void send(p.keys)}
            disabled={sending}
            title={p.title}
            className="text-xs font-mono rounded border border-base-300 px-1.5 py-0.5 hover:bg-base-200 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {p.label}
          </button>
        ))}
      </div>
      <form onSubmit={onSubmitFreeform} className="flex items-center gap-1">
        <input
          ref={inputRef}
          data-testid="send-freeform"
          type="text"
          value={freeForm}
          onChange={(e) => setFreeForm(e.target.value)}
          disabled={sending}
          placeholder="free-form keys (Enter auto-appended)"
          className="flex-1 min-w-0 rounded border border-base-300 bg-base-100 px-2 py-0.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <button
          type="submit"
          disabled={sending || freeForm.length === 0}
          className="text-xs rounded border border-primary bg-primary/15 text-primary px-2 py-0.5 hover:bg-primary/25 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {sending ? "…" : "Send"}
        </button>
      </form>
      {status ? (
        <div
          data-testid="send-status"
          className={`text-[11px] font-mono ${
            status.startsWith("failed") ? "text-error" : "text-success"
          }`}
        >
          {status}
        </div>
      ) : null}
    </div>
  )
}
