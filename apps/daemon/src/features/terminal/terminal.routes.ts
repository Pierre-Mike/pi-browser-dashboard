import { Effect } from "effect"
import { Hono } from "hono"
import { createBunWebSocket } from "hono/bun"
import type { ServerWebSocket } from "bun"
import { appRuntime } from "../../platform/runtime"
import { SessionRegistry } from "../sessions/sessions.repo"

const { upgradeWebSocket, websocket } = createBunWebSocket<ServerWebSocket>()

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

const spawnChild = (cwd: string, cmd: string, cols: number, rows: number) =>
  Bun.spawn(["bash", "-lc", cmd], {
    cwd,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      TERM: "xterm-256color",
      COLUMNS: String(cols),
      LINES: String(rows),
    },
  })

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

const app = new Hono().get(
  "/:id",
  upgradeWebSocket((c) => {
    const id = c.req.param("id") ?? ""
    // The browser sends its current xterm dims at connect-time. There is no
    // pty (Bun pipes only), so SIGWINCH isn't an option — these are the only
    // chance to size `claude attach` (and zellij inside it) correctly.
    const cols = clampDim(c.req.query("cols"), DEFAULT_COLS, 400)
    const rows = clampDim(c.req.query("rows"), DEFAULT_ROWS, 200)
    const tokenKey = {}
    return {
      onOpen: async (_evt, ws) => {
        if (!id) {
          ws.close(1011, "missing_id")
          return
        }
        const session = await appRuntime.runPromise(
          Effect.gen(function* () {
            const reg = yield* SessionRegistry
            return reg.getOne(id)
          }),
        )
        if (!session) {
          ws.send(`\r\n\x1b[31msession ${id} not found\x1b[0m\r\n`)
          ws.close(1011, "not_found")
          return
        }
        // The browser tab is our multiplexer. Skip zellij and attach the
        // supervisor session directly; the bash wrapper lands us in the
        // session's worktree first so `pwd` looks right after detach.
        const cwd = session.cwd || process.env.HOME || "/"
        const cmd = `cd ${JSON.stringify(cwd)} && exec claude attach ${session.short}`
        const child = spawnChild(cwd, cmd, cols, rows)
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
            ws.send(`\r\n\x1b[2mclaude attach exited (${code})\x1b[0m\r\n`)
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
        try {
          b.child.stdin.write("\x1a") // Ctrl+Z — detach cleanly
          b.child.stdin.flush()
        } catch {
          // ignore
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
  }),
)

export { app, websocket }
