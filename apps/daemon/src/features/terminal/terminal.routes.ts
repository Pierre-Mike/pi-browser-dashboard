import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect } from "effect"
import type { Context } from "hono"
import { Hono } from "hono"
import { appRuntime } from "../../platform/runtime"
import { upgradeWebSocket } from "../../platform/ws"
import { ProjectsService } from "../projects/projects.repo"
import { SessionRegistry } from "../sessions/sessions.repo"
import {
  buildChildArgv,
  cleanZellijEnv,
  formatSizeFileContent,
  GLOBAL_ZELLIJ_SESSION,
  globalTerminalCwd,
  HEARTBEAT_PAYLOAD,
  parseClientMessage,
  projectZellijCommand,
  sessionZellijCommand,
  shouldAutoKillSession,
  zellijKillSessionArgv,
  zellijSessionName,
} from "./terminal.core"

type Bridge = {
  child: Bun.Subprocess<"pipe", "pipe", "pipe">
  drainAbort: AbortController
  sizefile: string
  sizedir: string
  heartbeat: ReturnType<typeof setInterval>
}

// Minimal child interface for testing closeChildBridge in isolation.
// `_resolveExited` is test-only scaffolding (not present on Bun.Subprocess).
export type ChildBridgeForTest = {
  kill: () => void
  exited: Promise<number>
  _resolveExited: () => void
}

// Exported for unit-testing reap behaviour. Called by onClose after the grace
// delay — kills the pty wrapper subprocess and awaits exited so Bun reaps it
// (no zombie). delayMs is configurable so tests can pass 0 and stay fast.
export const closeChildBridge = async (args: {
  child: Pick<ChildBridgeForTest, "kill" | "exited">
  sizedir: string
  delayMs?: number
}): Promise<void> => {
  const { child, sizedir, delayMs = 1_000 } = args
  await new Promise<void>((resolve) => setTimeout(resolve, delayMs))
  try {
    child.kill()
  } catch {
    // already exited
  }
  // Reap the subprocess: the setsid pty wrapper is its own session leader and
  // SIGTERM only kills the python3 wrapper, leaving it as a zombie until its pty
  // child exits. Awaiting exited lets Bun reap the process table entry.
  void child.exited
  try {
    rmSync(sizedir, { recursive: true, force: true })
  } catch {
    // already gone
  }
}

const bridges = new WeakMap<object, Bridge>()

// Idle proxies (Vite dev server, OS NAT) drop WebSockets after 60-120s of
// silence. zellij output is bursty — a user staring at a TUI sees no traffic
// for minutes, then SIGPIPE on next keystroke. Server-pushed JSON heartbeat
// keeps the connection warm AND lets the client detect a half-open socket
// (the browser fires onclose when send fails). 20s undershoots every proxy
// idle window I've checked.
const HEARTBEAT_INTERVAL_MS = 20_000

const DEFAULT_COLS = 120
const DEFAULT_ROWS = 32

const clampDim = ({
  raw,
  fallback,
  max,
}: {
  raw: string | undefined
  fallback: number
  max: number
}): number => {
  if (!raw) return fallback
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.min(n, max)
}

const spawnChild = (args: {
  readonly cwd: string
  readonly cmd: string
  readonly cols: number
  readonly rows: number
  readonly pty: boolean
  readonly sizefile: string
}) => {
  // The wrapper now handles size: it reads sizefile + applies TIOCSWINSZ on
  // the master fd at spawn AND on every SIGWINCH. The inline `stty rows … cols
  // …` shim is gone — TIOCSWINSZ is the canonical mechanism and a
  // controlling-tty stty inside the child was always a workaround.
  return Bun.spawn(
    buildChildArgv({
      cmd: args.cmd,
      pty: args.pty,
      platform: process.platform,
      sizefile: args.sizefile,
    }),
    {
      cwd: args.cwd,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...cleanZellijEnv(process.env),
        TERM: "xterm-256color",
        // COLUMNS / LINES are still set as a belt-and-braces for any tool that
        // reads them before the first SIGWINCH lands.
        COLUMNS: String(args.cols),
        LINES: String(args.rows),
      },
    },
  )
}

const pipeStream = async ({
  stream,
  send,
  signal,
}: {
  stream: ReadableStream<Uint8Array>
  send: (chunk: Uint8Array) => void
  signal: AbortSignal
}): Promise<void> => {
  const reader = stream.getReader()
  try {
    while (!signal.aborted) {
      const { value, done } = await reader.read()
      if (done) break
      if (value) send(value)
    }
  } catch {
    // stream closed
  } finally {
    try {
      reader.releaseLock()
    } catch {
      // ignore
    }
  }
}

type Resolved =
  | {
      readonly ok: true
      readonly cwd: string
      readonly cmd: string
      // Used by the fast-crash recovery path: if `zellij attach <name>`
      // panics on startup against a wedged session, we run
      // `zellij kill-session <name>` so the next reconnect hits the create
      // branch and rebuilds the session fresh. Null when the route can't
      // identify a session (defensive — current callers all set it).
      readonly sessionName: string | null
    }
  | { readonly ok: false; readonly reason: string }

type BridgeOpts = {
  readonly resolveCommand: (c: Context) => Promise<Resolved>
  // When true, route the child through a forkpty wrapper so it inherits a
  // real pty. Required for zellij (raw-mode); all three terminal routes use
  // zellij now, so callers always pass true.
  readonly pty?: boolean
}

const makeWsHandler = ({ resolveCommand, pty = false }: BridgeOpts) =>
  upgradeWebSocket((c) => {
    // The browser sends its current xterm dims at connect-time. Without a
    // resize channel from the browser these are the only chance to size the
    // child correctly — passed via env (pipes) or stty (pty wrapper).
    const cols = clampDim({ raw: c.req.query("cols"), fallback: DEFAULT_COLS, max: 400 })
    const rows = clampDim({ raw: c.req.query("rows"), fallback: DEFAULT_ROWS, max: 200 })
    const tokenKey = {}
    return {
      onOpen: async (_evt, ws) => {
        const resolved = await resolveCommand(c)
        if (!resolved.ok) {
          try {
            ws.send(`\r\n\x1b[31m${resolved.reason}\x1b[0m\r\n`)
          } catch {
            // ws closed before send
          }
          ws.close(1011, resolved.reason)
          return
        }
        // Per-bridge sizefile. mkdtempSync gives us a private directory so
        // two terminals can't race on the same path. The wrapper opens this
        // every SIGWINCH; the route rewrites it on every resize message.
        const sizedir = mkdtempSync(join(tmpdir(), "pid-term-"))
        const sizefile = join(sizedir, "size")
        writeFileSync(sizefile, formatSizeFileContent({ cols, rows }))

        const child = spawnChild({
          cwd: resolved.cwd,
          cmd: resolved.cmd,
          cols,
          rows,
          pty,
          sizefile,
        })
        const spawnedAt = Date.now()
        const drainAbort = new AbortController()
        const heartbeat = setInterval(() => {
          try {
            ws.send(HEARTBEAT_PAYLOAD)
          } catch {
            // ws closed; onClose will clear the interval
          }
        }, HEARTBEAT_INTERVAL_MS)
        bridges.set(tokenKey, { child, drainAbort, sizefile, sizedir, heartbeat })

        const send = (bytes: Uint8Array) => {
          try {
            // Copy into a fresh ArrayBuffer-backed Uint8Array; Bun's WS
            // typings refuse ArrayBufferLike variants from Bun streams.
            const copy = new Uint8Array(bytes.byteLength)
            copy.set(bytes)
            ws.send(copy)
          } catch {
            // ws closed
          }
        }
        void pipeStream({ stream: child.stdout, send, signal: drainAbort.signal })
        void pipeStream({ stream: child.stderr, send, signal: drainAbort.signal })

        void child.exited.then((code) => {
          // Detect the "zellij attach panicked on startup" loop: client panics
          // with EIO sub-second against a wedged session, exits non-zero, and
          // the server-side session sticks around so the next attach panics
          // again. shouldAutoKillSession encapsulates the heuristic; if it
          // fires, kill the wedged session so the next reconnect hits the
          // create branch and rebuilds it from the layout.
          const elapsedMs = Date.now() - spawnedAt
          const autoKill = shouldAutoKillSession({
            elapsedMs,
            exitCode: code,
            sessionName: resolved.sessionName,
          })
          let exitMessage = `\r\n\x1b[2mchild exited (${code})\x1b[0m\r\n`
          if (autoKill && resolved.sessionName !== null) {
            // Fire-and-forget — the user-facing message is sent immediately so
            // the WS close doesn't race the kill subprocess. Errors swallowed:
            // the kill is best-effort recovery, the next attach reveals
            // whether it worked.
            void killZellijSession(resolved.sessionName)
            exitMessage = `\r\n\x1b[33mzellij client crashed on startup (exit ${code} in ${elapsedMs}ms); reset session '${resolved.sessionName}' — click Reconnect to spawn a fresh one.\x1b[0m\r\n`
          }
          try {
            ws.send(exitMessage)
            ws.close(1000, "child_exited")
          } catch {
            // ws already closed
          }
        })
      },
      onMessage: (evt) => {
        const b = bridges.get(tokenKey)
        if (!b) return
        const data = evt.data
        // Resize control travels as a JSON text frame; everything else is
        // forwarded to the child's stdin verbatim. parseClientMessage degrades
        // malformed JSON to "input" so a paste of JSON-shaped text from the
        // user still reaches the shell.
        if (typeof data === "string") {
          const parsed = parseClientMessage(data)
          if (parsed.kind === "resize") {
            try {
              writeFileSync(
                b.sizefile,
                formatSizeFileContent({ cols: parsed.cols, rows: parsed.rows }),
              )
            } catch {
              // sizefile gone (race with onClose); nothing to signal
              return
            }
            const pid = b.child.pid
            if (pid !== undefined) {
              try {
                process.kill(pid, "SIGWINCH")
              } catch {
                // child already exited
              }
            }
            return
          }
        }
        try {
          if (typeof data === "string") {
            b.child.stdin.write(data)
          } else if (data instanceof ArrayBuffer) {
            b.child.stdin.write(new Uint8Array(data))
          } else if (data instanceof Uint8Array) {
            b.child.stdin.write(data)
          }
          b.child.stdin.flush()
        } catch {
          // child stdin closed
        }
      },
      onClose: () => {
        const b = bridges.get(tokenKey)
        if (!b) return
        bridges.delete(tokenKey)
        clearInterval(b.heartbeat)
        b.drainAbort.abort()
        void closeChildBridge({ child: b.child, sizedir: b.sizedir })
      },
    }
  })

const resolveSessionCommand = async (c: Context): Promise<Resolved> => {
  const id = c.req.param("id") ?? ""
  if (!id) return { ok: false, reason: "missing_id" }
  const session = await appRuntime.runPromise(
    Effect.gen(function* () {
      const reg = yield* SessionRegistry
      return reg.getOne(id)
    }),
  )
  if (!session) return { ok: false, reason: `session ${id} not found` }
  // Wrap the drill-in in a per-session zellij so the tab bar is visible and
  // a second pane (tail logs, run tests) can live next to the claude TUI.
  // The user runs `claude attach <short>` themselves — SessionCard already
  // exposes a copy button for the exact command.
  const cwd = session.cwd || process.env.HOME || "/"
  const cmd = sessionZellijCommand({ cwd, short: session.short })
  if (cmd === null) return { ok: false, reason: "invalid_id" }
  return { ok: true, cwd, cmd, sessionName: zellijSessionName(session.short) }
}

// Dashboard global terminal: pinned to zellij session "default". No id in the
// URL — there's exactly one of these per daemon. cwd defaults to $HOME so the
// user lands somewhere sensible the first time they open it.
const resolveGlobalCommand = async (_c: Context): Promise<Resolved> => {
  const cwd = globalTerminalCwd(process.env)
  const cmd = projectZellijCommand({ cwd, sessionName: GLOBAL_ZELLIJ_SESSION })
  return { ok: true, cwd, cmd, sessionName: GLOBAL_ZELLIJ_SESSION }
}

const resolveProjectCommand = async (c: Context): Promise<Resolved> => {
  const id = c.req.param("id") ?? ""
  if (!id) return { ok: false, reason: "missing_id" }
  const sessionName = zellijSessionName(id)
  if (!sessionName) return { ok: false, reason: "invalid_id" }
  const projects = await appRuntime.runPromise(
    Effect.gen(function* () {
      const svc = yield* ProjectsService
      return yield* svc.list()
    }),
  )
  const project = projects.find((p) => p.id === id)
  if (!project) return { ok: false, reason: `project ${id} not found` }
  const cmd = projectZellijCommand({ cwd: project.path, sessionName })
  return { ok: true, cwd: project.path, cmd, sessionName }
}

// Wedge recovery: `zellij kill-session <name>` so the user doesn't have to
// reach for a real terminal when a session goes unresponsive. Always returns
// 200 — distinguishing "no such session" from "killed" doesn't help the UI,
// which just wants the chance to reconnect to a fresh session.
const killZellijSession = async (sessionName: string | null): Promise<{ ok: boolean }> => {
  if (!sessionName) return { ok: false }
  try {
    const proc = Bun.spawn(zellijKillSessionArgv(sessionName), {
      stdout: "pipe",
      stderr: "pipe",
      env: cleanZellijEnv(process.env),
    })
    await proc.exited
    return { ok: proc.exitCode === 0 }
  } catch {
    return { ok: false }
  }
}

const resolveProjectKillName = async (id: string): Promise<string | null> => {
  const sessionName = zellijSessionName(id)
  if (!sessionName) return null
  return sessionName
}

const resolveSessionKillName = async (id: string): Promise<string | null> => {
  const session = await appRuntime.runPromise(
    Effect.gen(function* () {
      const reg = yield* SessionRegistry
      return reg.getOne(id)
    }),
  )
  if (!session) return null
  return zellijSessionName(session.short)
}

const app = new Hono()
  .get("/global", makeWsHandler({ resolveCommand: resolveGlobalCommand, pty: true }))
  .get("/project/:id", makeWsHandler({ resolveCommand: resolveProjectCommand, pty: true }))
  .delete("/global", async (c) => c.json(await killZellijSession(GLOBAL_ZELLIJ_SESSION)))
  .delete("/project/:id", async (c) => {
    const id = c.req.param("id") ?? ""
    return c.json(await killZellijSession(await resolveProjectKillName(id)))
  })
  .delete("/:id", async (c) => {
    const id = c.req.param("id") ?? ""
    return c.json(await killZellijSession(await resolveSessionKillName(id)))
  })
  .get("/:id", makeWsHandler({ resolveCommand: resolveSessionCommand, pty: true }))

export { app }
