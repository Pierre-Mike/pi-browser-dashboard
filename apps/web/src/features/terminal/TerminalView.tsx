import { FitAddon } from "@xterm/addon-fit"
import { Terminal } from "@xterm/xterm"
import "@xterm/xterm/css/xterm.css"
import { useEffect, useRef, useState } from "react"
import { wsBase } from "../../lib/apiBase"
import { subscribeDroppedPaths } from "../uploads/dropEvents"
import { shellQuotePath } from "./ptyPath"
import { type ColorScheme, schemeForPrefersDark, terminalTheme } from "./terminalTheme"
import { terminalKillUrl, terminalWsUrl } from "./terminalUrl"

type Props = {
  readonly reconnectTitle: string
  readonly testId?: string
} & (
  | { readonly kind: "session" | "project"; readonly id: string }
  | { readonly kind: "global" | "orchestrator" }
)

// Server → client control frames are JSON text starting with '{'. Inline
// errors / exit notices that the daemon paints into the terminal start with
// "\r\n", so the leading-byte check is enough to route without parsing every
// pty chunk.
const isControlFrame = (data: string): boolean => data.length > 0 && data.charCodeAt(0) === 0x7b

// "global" and "orchestrator" are the id-less terminal kinds (one fixed zellij
// session each, no URL id segment). Extracted as a guard so the kind→URL
// branches below stay single-decision: narrows to the no-id terminalUrl variant.
const isIdlessKind = (kind: Props["kind"]): kind is "global" | "orchestrator" =>
  kind === "global" || kind === "orchestrator"

const PREFERS_DARK = "(prefers-color-scheme: dark)"

// Tailwind runs in darkMode:"media", so the terminal follows the same OS
// preference: light xterm palette in light mode, the original dark one in
// dark mode, switching live when the OS theme flips.
const usePreferredScheme = (): ColorScheme => {
  const [scheme, setScheme] = useState<ColorScheme>(() =>
    schemeForPrefersDark(window.matchMedia(PREFERS_DARK).matches),
  )
  useEffect(() => {
    const mq = window.matchMedia(PREFERS_DARK)
    const onChange = (ev: MediaQueryListEvent) => setScheme(schemeForPrefersDark(ev.matches))
    mq.addEventListener("change", onChange)
    return () => mq.removeEventListener("change", onChange)
  }, [])
  return scheme
}

export const TerminalView = (props: Props) => {
  const { kind, reconnectTitle, testId } = props
  const id = "id" in props ? props.id : ""
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const scheme = usePreferredScheme()
  const [status, setStatus] = useState<"connecting" | "open" | "closed" | "error">("connecting")
  const [_reconnectKey, setReconnectKey] = useState(0)
  const [restarting, setRestarting] = useState(false)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const term = new Terminal({
      fontFamily:
        'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
      fontSize: 13,
      // Read the media query directly so this effect doesn't depend on
      // `scheme` (re-running it would tear down the WS); the effect below
      // applies live scheme changes via term.options.theme.
      theme: { ...terminalTheme(schemeForPrefersDark(window.matchMedia(PREFERS_DARK).matches)) },
      convertEol: true,
      cursorBlink: true,
      scrollback: 5_000,
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host)
    termRef.current = term
    const safeFit = () => {
      try {
        fit.fit()
      } catch {
        // host might have zero size on first paint; later retries handle it
      }
    }

    let ws: WebSocket | null = null
    let dataSub: { dispose: () => void } | null = null
    let resizeSub: { dispose: () => void } | null = null
    let lastCols = 0
    let lastRows = 0
    const rafIds: number[] = []
    const timers: ReturnType<typeof setTimeout>[] = []
    let disposed = false

    const sendResize = (cols: number, rows: number): void => {
      if (!ws || ws.readyState !== WebSocket.OPEN) return
      if (cols === lastCols && rows === lastRows) return
      lastCols = cols
      lastRows = rows
      try {
        ws.send(JSON.stringify({ type: "resize", cols, rows }))
      } catch {
        // ws closed between readyState check and send
      }
    }

    // First-mount: the daemon's initial pty geometry is the cols/rows query
    // on the WS URL. After open, ResizeObserver fires fit() on every host
    // dim change; we forward the new xterm cols/rows to the daemon, which
    // rewrites the sizefile and sends SIGWINCH to the pty wrapper. Without
    // this loop the user resizes the window and zellij stays at the seal-in
    // size until reconnect.
    const openWs = () => {
      if (disposed || ws) return
      safeFit()
      lastCols = term.cols
      lastRows = term.rows
      const url = isIdlessKind(kind)
        ? terminalWsUrl({ baseUrl: wsBase(), kind, cols: term.cols, rows: term.rows })
        : terminalWsUrl({
            baseUrl: wsBase(),
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
          // Heartbeat / future control frames travel as JSON text. Routing on
          // the leading '{' keeps the pty fast path zero-overhead.
          if (isControlFrame(ev.data)) return
          term.write(ev.data)
        }
      }
      sock.onerror = () => setStatus("error")
      sock.onclose = () => setStatus("closed")

      dataSub = term.onData((d) => {
        if (sock.readyState === WebSocket.OPEN) sock.send(d)
      })
      resizeSub = term.onResize(({ cols, rows }) => sendResize(cols, rows))
    }

    // Pipe dropped-file paths into this terminal's pty as if the user had
    // typed them. Only the on-screen terminal consumes — IndexPage keeps the
    // GlobalTerminal mounted under `display: none` while another tab is
    // active, and we don't want to type into hidden ptys.
    const offDrop = subscribeDroppedPaths((path) => {
      if (host.offsetParent === null) return
      if (ws?.readyState === WebSocket.OPEN) ws.send(shellQuotePath(path))
    })

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
      offDrop()
      for (const id of rafIds) cancelAnimationFrame(id)
      for (const t of timers) clearTimeout(t)
      ro.disconnect()
      dataSub?.dispose()
      resizeSub?.dispose()
      if (ws) {
        try {
          ws.close()
        } catch {
          // ignore
        }
      }
      termRef.current = null
      term.dispose()
    }
  }, [kind, id])

  useEffect(() => {
    // xterm only repaints when options.theme is assigned a fresh object.
    if (termRef.current) termRef.current.options.theme = { ...terminalTheme(scheme) }
  }, [scheme])

  const onRestart = async (): Promise<void> => {
    if (restarting) return
    setRestarting(true)
    try {
      const url = isIdlessKind(kind)
        ? terminalKillUrl({ baseUrl: wsBase(), kind })
        : terminalKillUrl({ baseUrl: wsBase(), kind, id })
      try {
        await fetch(url, { method: "DELETE" })
      } catch {
        // wedge recovery is best-effort: even if the DELETE fails, force a
        // fresh WS — the next attach hits the lockdir create branch and
        // builds a new zellij session if the old one is truly gone.
      }
    } finally {
      setRestarting(false)
      setReconnectKey((k) => k + 1)
    }
  }

  return (
    <div data-testid={testId ?? "terminal-view"} className="flex flex-col h-full">
      <div
        ref={hostRef}
        data-testid="terminal-host"
        className="flex-1 min-h-0 rounded-lg p-2 shadow-inner"
        style={{ backgroundColor: terminalTheme(scheme).background }}
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
          data-testid="terminal-restart"
          onClick={onRestart}
          disabled={restarting}
          className="ml-auto rounded border border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-200 px-2 py-0.5 hover:bg-rose-50 dark:hover:bg-rose-950/40 disabled:opacity-50"
          title="Kill the zellij session on the daemon and reconnect"
        >
          {restarting ? "Restarting…" : "Restart"}
        </button>
        <button
          type="button"
          onClick={() => setReconnectKey((k) => k + 1)}
          className="rounded border border-slate-300 dark:border-slate-700 px-2 py-0.5 hover:bg-slate-100 dark:hover:bg-slate-800"
          title={reconnectTitle}
        >
          Reconnect
        </button>
      </div>
    </div>
  )
}
