import { useState } from "react"
import { type TunnelStatus, useStartTunnel, useStopTunnel, useTunnelStatus } from "./useTunnel"

const STATUS_BADGE: Record<TunnelStatus, string> = {
  stopped: "badge-ghost",
  starting: "badge-warning",
  running: "badge-success",
  error: "badge-error",
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
      className="flex flex-col gap-3 max-w-2xl rounded-lg border border-base-300 bg-base-200/40 p-4"
    >
      <header className="flex items-center justify-between gap-3">
        <div className="flex flex-col">
          <h2 className="text-sm font-semibold">Cloudflare tunnel</h2>
          <p className="text-xs text-base-content/50">
            A public URL for this dashboard. One tunnel starts automatically on every boot.
          </p>
        </div>
        <span data-testid="tunnel-status" className={`badge badge-sm ${STATUS_BADGE[status]}`}>
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
          className="input input-bordered input-sm flex-1 font-mono text-xs"
        />
        <button
          type="button"
          data-testid="tunnel-reveal"
          onClick={() => setRevealed((v) => !v)}
          disabled={!running || !url}
          aria-pressed={revealed}
          aria-label={revealed ? "Hide URL" : "Reveal URL"}
          className="btn btn-sm btn-ghost normal-case"
        >
          {revealed ? "Hide" : "Reveal"}
        </button>
        <button
          type="button"
          data-testid="tunnel-copy"
          onClick={copy}
          disabled={!running || !url}
          className="btn btn-sm btn-ghost normal-case"
        >
          {copied ? "Copied" : "Copy"}
        </button>
        <a
          data-testid="tunnel-open"
          href={running && url ? url : undefined}
          target="_blank"
          rel="noopener noreferrer"
          aria-disabled={!running || !url}
          className={`btn btn-sm btn-ghost normal-case ${running && url ? "" : "btn-disabled"}`}
        >
          Open
        </a>
      </label>

      {status === "error" && state?.error ? (
        <p data-testid="tunnel-error" className="text-xs text-error">
          {state.error}
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <button
          type="button"
          data-testid="tunnel-toggle"
          onClick={toggle}
          disabled={busy}
          className={`btn btn-sm normal-case shadow-sm ${
            running ? "btn-error" : "btn-primary shadow-primary/30"
          }`}
        >
          {busy ? <span className="loading loading-spinner loading-xs" /> : null}
          {busy ? "Working…" : running ? "Stop tunnel" : "Start tunnel"}
        </button>
        {q.isError ? (
          <span className="text-xs text-error">
            {q.error instanceof Error ? q.error.message : "Failed to load status"}
          </span>
        ) : null}
      </div>

      <p className="text-[11px] text-warning border border-warning/30 bg-warning/10 rounded px-2 py-1.5">
        ⚠ Anyone with this URL can reach your dashboard. There is no authentication — stop the
        tunnel when you are done.
      </p>
    </div>
  )
}
