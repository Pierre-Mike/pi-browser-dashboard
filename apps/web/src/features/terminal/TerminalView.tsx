import { FitAddon } from "@xterm/addon-fit"
import { Terminal } from "@xterm/xterm"
import "@xterm/xterm/css/xterm.css"
import { useEffect, useRef, useState } from "react"
import { terminalWsUrl } from "./terminalUrl"

type Props = {
  readonly reconnectTitle: string
  readonly testId?: string
} & ({ readonly kind: "session" | "project"; readonly id: string } | { readonly kind: "global" })

const apiBase = (): string =>
  (import.meta.env.VITE_API_URL as string | undefined) ?? "http://localhost:8787"

export const TerminalView = (props: Props) => {
  const { kind, reconnectTitle, testId } = props
  const id = "id" in props ? props.id : ""
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

    let ws: WebSocket | null = null
    let dataSub: { dispose: () => void } | null = null
    const rafIds: number[] = []
    const timers: ReturnType<typeof setTimeout>[] = []
    let disposed = false

    // The daemon seals the child pty size at spawn time from these query
    // params — there's no SIGWINCH channel back to the child. FitAddon
    // silently no-ops when xterm's renderer hasn't measured a char cell yet
    // (the normal state right after term.open()), so reading term.cols/rows
    // synchronously hands the daemon xterm's 80×24 default and strands the
    // zellij session at that size forever. Defer WS open until fit resolves.
    const openWs = () => {
      if (disposed || ws) return
      safeFit()
      const url =
        kind === "global"
          ? terminalWsUrl({ baseUrl: apiBase(), kind: "global", cols: term.cols, rows: term.rows })
          : terminalWsUrl({
              baseUrl: apiBase(),
              kind,
              id,
              cols: term.cols,
              rows: term.rows,
            })
      const sock = new WebSocket(url)
      sock.binaryType = "arraybuffer"
      ws = sock

      const decoder = new TextDecoder()
      sock.onopen = () => setStatus("open")
      sock.onmessage = (ev) => {
        if (ev.data instanceof ArrayBuffer) {
          term.write(decoder.decode(new Uint8Array(ev.data)))
        } else if (typeof ev.data === "string") {
          term.write(ev.data)
        }
      }
      sock.onerror = () => setStatus("error")
      sock.onclose = () => setStatus("closed")

      dataSub = term.onData((d) => {
        if (sock.readyState === WebSocket.OPEN) sock.send(d)
      })
    }

    // Try fit across upcoming frames; open WS on the first frame where the
    // host has real dims AND fit produced something larger than xterm's
    // 80×24 default. Cap attempts so a genuinely tiny container still
    // connects eventually (better small than never).
    const MAX_ATTEMPTS = 8
    let attempts = 0
    const tryOpen = () => {
      if (disposed || ws) return
      attempts++
      safeFit()
      const sized = host.clientWidth > 0 && host.clientHeight > 0
      const fitResolved = term.cols > 80 || term.rows > 24
      if (sized && (fitResolved || attempts >= MAX_ATTEMPTS)) {
        openWs()
        return
      }
      rafIds.push(requestAnimationFrame(tryOpen))
    }
    rafIds.push(requestAnimationFrame(tryOpen))
    timers.push(setTimeout(tryOpen, 250))

    const ro = new ResizeObserver(safeFit)
    ro.observe(host)

    return () => {
      disposed = true
      for (const id of rafIds) cancelAnimationFrame(id)
      for (const t of timers) clearTimeout(t)
      ro.disconnect()
      dataSub?.dispose()
      if (ws) {
        try {
          ws.close()
        } catch {
          // ignore
        }
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
