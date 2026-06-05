import { useState } from "react"
import { type TunnelStatus, useStartTunnel, useStopTunnel, useTunnelStatus } from "./useTunnel"

const STATUS_TONE: Record<TunnelStatus, string> = {
  stopped: "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300",
  starting: "bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200",
  running: "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-200",
  error: "bg-rose-100 dark:bg-rose-900/40 text-rose-800 dark:text-rose-200",
}

const STATUS_LABEL: Record<TunnelStatus, string> = {
  stopped: "Stopped",
  starting: "Starting…",
  running: "Running",
  error: "Error",
}

export const TunnelPanel = () => {
  const q = useTunnelStatus()
  const start = useStartTunnel()
  const stop = useStopTunnel()
  const [copied, setCopied] = useState(false)
  const [revealed, setRevealed] = useState(false)

  const state = q.data
  const status: TunnelStatus = state?.status ?? "stopped"
  const url = state?.url ?? ""
  const running = status === "running"
  const busy = status === "starting" || start.isPending || stop.isPending

  const copy = (): void => {
    if (!url) return
    void navigator.clipboard.writeText(url).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  const toggle = (): void => {
    if (running) stop.mutate()
    else start.mutate()
  }

  return (
    <div
      data-testid="tunnel-panel"
      className="flex flex-col gap-3 max-w-2xl rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4"
    >
      <header className="flex items-center justify-between gap-3">
        <div className="flex flex-col">
          <h2 className="text-sm font-semibold">Cloudflare tunnel</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            A public URL for this dashboard. One tunnel starts automatically on every boot.
          </p>
        </div>
        <span
          data-testid="tunnel-status"
          className={`text-[10px] uppercase tracking-wide rounded px-2 py-0.5 font-medium ${STATUS_TONE[status]}`}
        >
          {STATUS_LABEL[status]}
        </span>
      </header>

      <label className="flex items-center gap-2">
        <span className="sr-only">Cloudflare URL</span>
        <input
          data-testid="tunnel-url"
          type={revealed ? "text" : "password"}
          readOnly
          value={url}
          placeholder={running ? "" : "No active tunnel"}
          autoComplete="off"
          className="flex-1 font-mono text-xs rounded border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950/60 px-2 py-1.5"
        />
        <button
          type="button"
          data-testid="tunnel-reveal"
          onClick={() => setRevealed((v) => !v)}
          disabled={!running || !url}
          aria-pressed={revealed}
          aria-label={revealed ? "Hide URL" : "Reveal URL"}
          className="text-xs rounded border border-slate-300 dark:border-slate-700 px-2 py-1.5 disabled:opacity-40 hover:bg-slate-50 dark:hover:bg-slate-800"
        >
          {revealed ? "Hide" : "Reveal"}
        </button>
        <button
          type="button"
          data-testid="tunnel-copy"
          onClick={copy}
          disabled={!running || !url}
          className="text-xs rounded border border-slate-300 dark:border-slate-700 px-2 py-1.5 disabled:opacity-40 hover:bg-slate-50 dark:hover:bg-slate-800"
        >
          {copied ? "Copied" : "Copy"}
        </button>
        <a
          data-testid="tunnel-open"
          href={running && url ? url : undefined}
          target="_blank"
          rel="noopener noreferrer"
          aria-disabled={!running || !url}
          className={`text-xs rounded border border-slate-300 dark:border-slate-700 px-2 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-800 ${
            running && url ? "" : "opacity-40 pointer-events-none"
          }`}
        >
          Open
        </a>
      </label>

      {status === "error" && state?.error ? (
        <p data-testid="tunnel-error" className="text-xs text-rose-600 dark:text-rose-400">
          {state.error}
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <button
          type="button"
          data-testid="tunnel-toggle"
          onClick={toggle}
          disabled={busy}
          className={`text-xs font-medium rounded px-3 py-1.5 text-white disabled:opacity-50 ${
            running ? "bg-rose-600 hover:bg-rose-700" : "bg-sky-600 hover:bg-sky-700"
          }`}
        >
          {busy ? "Working…" : running ? "Stop tunnel" : "Start tunnel"}
        </button>
        {q.isError ? (
          <span className="text-xs text-rose-600">
            {q.error instanceof Error ? q.error.message : "Failed to load status"}
          </span>
        ) : null}
      </div>

      <p className="text-[11px] text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/30 rounded px-2 py-1.5">
        ⚠ Anyone with this URL can reach your dashboard. There is no authentication — stop the
        tunnel when you are done.
      </p>
    </div>
  )
}
