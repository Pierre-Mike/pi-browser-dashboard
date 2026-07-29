import { useQueryClient } from "@tanstack/react-query"
import { useRef, useState } from "react"
import { api } from "../../lib/api"

type Props = { short: string }

// Named keys the daemon's POST /:id/keys vocabulary accepts — kept in sync
// with NamedKey in apps/daemon/src/features/sessions/sessions-keys.core.ts.
// Only the subset the nav row below actually uses is listed here.
type NamedKey = "up" | "down" | "tab" | "escape"

const PRESETS: ReadonlyArray<{ label: string; keys: string; title: string }> = [
  { label: "y", keys: "y\r", title: "yes + enter" },
  { label: "n", keys: "n\r", title: "no + enter" },
  { label: "1", keys: "1\r", title: "option 1" },
  { label: "2", keys: "2\r", title: "option 2" },
  { label: "3", keys: "3\r", title: "option 3" },
  { label: "⏎", keys: "\r", title: "enter" },
  { label: "Esc", keys: "", title: "escape" },
]

// Navigation row: answers a menu (AskUserQuestion / permission prompt) via
// the named vocabulary rather than a hand-encoded raw byte — the daemon-side
// vocabulary in sessions-keys.core.ts is the documented, testable source of
// truth for what each of these bytes actually is.
const NAV_KEYS: ReadonlyArray<{ label: string; testid: string; named: NamedKey; title: string }> = [
  { label: "↑", testid: "up", named: "up", title: "up arrow" },
  { label: "↓", testid: "down", named: "down", title: "down arrow" },
  { label: "⇥", testid: "tab", named: "tab", title: "tab" },
  { label: "Esc", testid: "escape", named: "escape", title: "escape (named)" },
]

export const SendKeysPanel = ({ short }: Props) => {
  const qc = useQueryClient()
  const [sending, setSending] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [freeForm, setFreeForm] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  // biome-ignore lint/suspicious/noExplicitAny: hc client typing depends on daemon AppType resolution
  const client = api as any

  // Shared status/spinner/error handling behind both send paths: the raw
  // `keys` string (POST /:id/send) and the named vocabulary (POST
  // /:id/keys). Each call site only supplies the request and success label.
  const runSend = async ({
    statusLabel,
    request,
  }: {
    statusLabel: string
    request: () => Promise<Response>
  }) => {
    if (sending) return
    setSending(true)
    setStatus(null)
    try {
      const res = await request()
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        setStatus(`failed: ${body.error ?? `HTTP ${res.status}`}`)
      } else {
        setStatus(statusLabel)
        qc.invalidateQueries({ queryKey: ["sessions"] })
      }
    } catch (err) {
      setStatus(`failed: ${err instanceof Error ? err.message : "unknown"}`)
    } finally {
      setSending(false)
      setTimeout(() => setStatus(null), 2_500)
    }
  }

  const send = (keys: string) => {
    if (keys.length === 0) return
    return runSend({
      statusLabel: `sent ${JSON.stringify(keys)}`,
      request: () => client.sessions[":id"].send.$post({ param: { id: short }, json: { keys } }),
    })
  }

  const sendNamed = (named: NamedKey) =>
    runSend({
      statusLabel: `sent ${named}`,
      request: () =>
        client.sessions[":id"].keys.$post({
          param: { id: short },
          json: { sequence: [{ named }] },
        }),
    })

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
      className="mt-1 rounded-box border border-base-300 bg-base-200 p-2 flex flex-col gap-1.5"
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
            className="text-xs font-mono rounded-btn border border-base-300 px-1.5 py-0.5 hover:bg-base-200 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1 flex-wrap">
        <span className="text-[10px] uppercase tracking-wide text-base-content/60 mr-1">
          Navigate
        </span>
        {NAV_KEYS.map((n) => (
          <button
            type="button"
            key={n.testid}
            data-testid={`send-nav-${n.testid}`}
            onClick={() => void sendNamed(n.named)}
            disabled={sending}
            title={n.title}
            className="text-xs font-mono rounded-btn border border-base-300 px-1.5 py-0.5 hover:bg-base-200 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {n.label}
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
          className="flex-1 min-w-0 rounded-btn border border-base-300 bg-base-100 px-2 py-0.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <button
          type="submit"
          disabled={sending || freeForm.length === 0}
          className="text-xs rounded-btn border border-primary bg-primary/15 text-primary px-2 py-0.5 hover:bg-primary/25 disabled:opacity-40 disabled:cursor-not-allowed"
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
