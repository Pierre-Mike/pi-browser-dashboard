import { FitAddon } from "@xterm/addon-fit"
import { Terminal } from "@xterm/xterm"
import "@xterm/xterm/css/xterm.css"
import { useEffect, useRef, useState } from "react"
import { type TerminalKind, terminalWsUrl } from "./terminalUrl"

type Props = {
  readonly kind: TerminalKind
  readonly id: string
  readonly reconnectTitle: string
  readonly testId?: string
}

const apiBase = (): string =>
  (import.meta.env.VITE_API_URL as string | undefined) ?? "http://localhost:8787"

export const TerminalView = ({ kind, id, reconnectTitle, testId }: Props) => {
  const hostRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<"connecting" | "open" | "closed" | "error">("connecting")
  const [reconnectKey, setReconnectKey] = useState(0)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const term = new Terminal({
      fontFamily:
        'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
      fontSize: 13,
      theme: {
        background: "#0b1220",
        foreground: "#e2e8f0",
        cursor: "#38bdf8",
      },
      convertEol: true,
      cursorBlink: true,
      scrollback: 5_000,
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host)
    const safeFit = () => {
      try {
        fit.fit()
      } catch {
        // host might have zero size on first paint; later retries handle it
      }
    }
    // Flex layout + xterm renderer init aren't always settled when useEffect
    // runs. Initial fit can latch onto stale dims and leave the terminal stuck
    // at xterm's 80x24 default until a manual window resize. Schedule re-fits
    // across upcoming frames so we converge on real dims.
    safeFit()
    const rafId = requestAnimationFrame(safeFit)
    const fitTimers = [setTimeout(safeFit, 60), setTimeout(safeFit, 250)]

    // Bun pipes have no SIGWINCH, so the child sees whatever COLUMNS/LINES we
    // set at spawn — that's all the daemon has. Pass the dims produced by the
    // synchronous safeFit() above; the xterm canvas keeps re-fitting client
    // side, but the child-side size stays fixed until reconnect.
    const url = terminalWsUrl({
      baseUrl: apiBase(),
      kind,
      id,
      cols: term.cols,
      rows: term.rows,
    })
    const ws = new WebSocket(url)
    ws.binaryType = "arraybuffer"

    const decoder = new TextDecoder()
    ws.onopen = () => setStatus("open")
    ws.onmessage = (ev) => {
      if (ev.data instanceof ArrayBuffer) {
        term.write(decoder.decode(new Uint8Array(ev.data)))
      } else if (typeof ev.data === "string") {
        term.write(ev.data)
      }
    }
    ws.onerror = () => setStatus("error")
    ws.onclose = () => setStatus("closed")

    const dataSub = term.onData((d) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(d)
    })

    const ro = new ResizeObserver(safeFit)
    ro.observe(host)

    return () => {
      cancelAnimationFrame(rafId)
      for (const t of fitTimers) clearTimeout(t)
      ro.disconnect()
      dataSub.dispose()
      try {
        ws.close()
      } catch {
        // ignore
      }
      term.dispose()
    }
  }, [kind, id, reconnectKey])

  return (
    <div data-testid={testId ?? "terminal-view"} className="flex flex-col h-full">
      <div
        ref={hostRef}
        data-testid="terminal-host"
        className="flex-1 min-h-0 rounded-lg bg-[#0b1220] p-2 shadow-inner"
      />
      <div className="flex items-center gap-2 px-1 pt-1.5 text-[10px] text-slate-500 dark:text-slate-400">
        <span
          className={`px-1.5 py-0.5 rounded uppercase tracking-wide font-semibold ${
            status === "open"
              ? "bg-emerald-100 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200"
              : status === "connecting"
                ? "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300"
                : "bg-rose-100 dark:bg-rose-950/40 text-rose-800 dark:text-rose-200"
          }`}
        >
          {status}
        </span>
        <button
          type="button"
          onClick={() => setReconnectKey((k) => k + 1)}
          className="ml-auto rounded border border-slate-300 dark:border-slate-700 px-2 py-0.5 hover:bg-slate-100 dark:hover:bg-slate-800"
          title={reconnectTitle}
        >
          Reconnect
        </button>
      </div>
    </div>
  )
}
