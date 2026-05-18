import { writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect } from "effect"
import { Hono } from "hono"
import type { Context } from "hono"
import { appRuntime } from "../../platform/runtime"
import { upgradeWebSocket } from "../../platform/ws"
import { ProjectsService } from "../projects/projects.repo"
import { SessionRegistry } from "../sessions/sessions.repo"
import {
  GLOBAL_ZELLIJ_SESSION,
  buildChildArgv,
  CLAUDE_LAYOUT_KDL,
  cleanZellijEnv,
  globalTerminalCwd,
  projectZellijCommand,
  zellijSessionName,
} from "./terminal.core"

// zellij's --new-session-with-layout requires a file path, not a string. Write
// the static KDL once at module load and reuse the path; the file is tiny and
// the daemon process owns its lifetime. (mkstemp-per-spawn would force the
// bash wrapper to also clean it up, which exec replaces away.)
const CLAUDE_LAYOUT_FILE: string = (() => {
  const path = join(tmpdir(), "pid-zellij-claude-layout.kdl")
  writeFileSync(path, CLAUDE_LAYOUT_KDL, "utf8")
  return path
})()

type Bridge = {
  child: Bun.Subprocess<"pipe", "pipe", "pipe">
  drainAbort: AbortController
}

const bridges = new WeakMap<object, Bridge>()

const DEFAULT_COLS = 120
const DEFAULT_ROWS = 32

const clampDim = (raw: string | undefined, fallback: number, max: number): number => {
  if (!raw) return fallback
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.min(n, max)
}

const spawnChild = (cwd: string, cmd: string, cols: number, rows: number, pty: boolean) => {
  // When we allocate a pty via script(1), the daemon has no controlling tty
  // so script opens the new pty at its default size (often 0x0 or 80x24).
  // zellij reads the *terminal*'s size — not COLUMNS/LINES — so resize the
  // pty in-band with stty before launching the real command.
  const inner = pty ? `stty rows ${rows} cols ${cols} 2>/dev/null; ${cmd}` : cmd
  return Bun.spawn(buildChildArgv({ cmd: inner, pty, platform: process.platform }), {
    cwd,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...cleanZellijEnv(process.env),
      TERM: "xterm-256color",
      COLUMNS: String(cols),
      LINES: String(rows),
    },
  })
}

const pipeStream = async (
  stream: ReadableStream<Uint8Array>,
  send: (chunk: Uint8Array) => void,
  signal: AbortSignal,
): Promise<void> => {
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
  | { readonly ok: true; readonly cwd: string; readonly cmd: string }
  | { readonly ok: false; readonly reason: string }

type BridgeOpts = {
  readonly resolveCommand: (c: Context) => Promise<Resolved>
  // Optional pre-kill byte sequence to send on WS close. claude attach reads
  // Ctrl+Z as "detach"; zellij doesn't need anything — killing the client
  // process already detaches without disturbing the daemon-owned session.
  readonly detachBytes?: string
  // When true, route the child through script(1) so it inherits a real pty.
  // Required for zellij (raw-mode), unused by `claude attach` which tolerates
  // pipes.
  readonly pty?: boolean
}

const makeWsHandler = ({ resolveCommand, detachBytes, pty = false }: BridgeOpts) =>
  upgradeWebSocket((c) => {
    // The browser sends its current xterm dims at connect-time. Without a
    // resize channel from the browser these are the only chance to size the
    // child correctly — passed via env (pipes) or stty (pty wrapper).
    const cols = clampDim(c.req.query("cols"), DEFAULT_COLS, 400)
    const rows = clampDim(c.req.query("rows"), DEFAULT_ROWS, 200)
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
        const child = spawnChild(resolved.cwd, resolved.cmd, cols, rows, pty)
        const drainAbort = new AbortController()
        bridges.set(tokenKey, { child, drainAbort })

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
        void pipeStream(child.stdout, send, drainAbort.signal)
        void pipeStream(child.stderr, send, drainAbort.signal)

        void child.exited.then((code) => {
          try {
            ws.send(`\r\n\x1b[2mchild exited (${code})\x1b[0m\r\n`)
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
        b.drainAbort.abort()
        if (detachBytes !== undefined) {
          try {
            b.child.stdin.write(detachBytes)
            b.child.stdin.flush()
          } catch {
            // ignore
          }
        }
        setTimeout(() => {
          try {
            b.child.kill()
          } catch {
            // already exited
          }
        }, 1_000)
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
  // The browser tab is our multiplexer. Skip zellij and attach the
  // supervisor session directly; the bash wrapper lands us in the
  // session's worktree first so `pwd` looks right after detach.
  const cwd = session.cwd || process.env.HOME || "/"
  const cmd = `cd ${JSON.stringify(cwd)} && exec claude attach ${session.short}`
  return { ok: true, cwd, cmd }
}

// Dashboard global terminal: pinned to zellij session "default". No id in the
// URL — there's exactly one of these per daemon. cwd defaults to $HOME so the
// user lands somewhere sensible the first time they open it.
const resolveGlobalCommand = async (_c: Context): Promise<Resolved> => {
  const cwd = globalTerminalCwd(process.env)
  const cmd = projectZellijCommand({ cwd, sessionName: GLOBAL_ZELLIJ_SESSION })
  return { ok: true, cwd, cmd }
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
  const cmd = projectZellijCommand({
    cwd: project.path,
    sessionName,
    layoutFile: CLAUDE_LAYOUT_FILE,
  })
  return { ok: true, cwd: project.path, cmd }
}

const app = new Hono()
  .get("/global", makeWsHandler({ resolveCommand: resolveGlobalCommand, pty: true }))
  .get("/project/:id", makeWsHandler({ resolveCommand: resolveProjectCommand, pty: true }))
  .get("/:id", makeWsHandler({ resolveCommand: resolveSessionCommand, detachBytes: "\x1a" }))

export { app }
