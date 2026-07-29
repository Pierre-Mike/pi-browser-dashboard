import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect } from "effect"
import type { Context } from "hono"
import { Hono } from "hono"
import { appRuntime } from "../../platform/runtime"
import { sseBus } from "../../platform/sse-bus"
import { upgradeWebSocket } from "../../platform/ws"
import { readZellijPrefix } from "../../platform/zellij-prefix"
import { PiSessionsIo } from "../dispatch/pi-sessions.io"
import type { Project } from "../projects/projects.io"
import { ProjectsService } from "../projects/projects.io"
import { SessionRegistry } from "../sessions/sessions.io"
import {
  buildChildArgv,
  cleanZellijEnv,
  formatSizeFileContent,
  GLOBAL_ZELLIJ_SESSION,
  globalTerminalCwd,
  HEARTBEAT_PAYLOAD,
  ORCHESTRATOR_ZELLIJ_SESSION,
  orchestratorZellijCommand,
  parseClientMessage,
  piZellijSessionName,
  prefixedZellijSession,
  projectZellijCommand,
  resolveOrchestratorCwd,
  sessionPiZellijCommand,
  sessionZellijCommand,
  shouldAutoKillSession,
  zellijKillSessionArgv,
  zellijSessionName,
} from "./terminal.core"
import {
  type PollCandidate,
  type TerminalScope,
  zellijDumpScreenArgv,
  zellijListPanesArgv,
  zellijListSessionsArgv,
} from "./terminal-poll.core"
import { createTerminalPoller } from "./terminal-poll.io"
import {
  appendTail,
  classifyTail,
  decideTransition,
  type TerminalStateSlug,
  terminalStateKey,
} from "./terminal-state.core"

type Bridge = {
  child: Bun.Subprocess<"pipe", "pipe", "pipe">
  drainAbort: AbortController
  sizefile: string
  sizedir: string
  heartbeat: ReturnType<typeof setInterval>
  // Clears the state-classifier tap's pending throttle timer — released
  // alongside the rest of this connection's resources so a closed WS can't
  // leave a dangling setTimeout.
  classifierDispose: () => void
  // The zellij session this bridge is attached to, released on close so the
  // unattended poller can take the terminal back over. Null when the resolver
  // could not name one.
  sessionName: string | null
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

// The four terminal kinds this route mounts ("global" and "orchestrator" have
// no id segment in the URL — one fixed zellij session each — so their own scope
// name doubles as the id; see idForScope below) come from terminal-poll.core.ts,
// so the WS bridge and the unattended poller share one vocabulary.

type TerminalStateRecord = {
  readonly scope: TerminalScope
  readonly id: string
  readonly state: TerminalStateSlug
  readonly matcher: string | undefined
  readonly evidence: string | undefined
  readonly at: string
}

// Last known classification per terminal, keyed by terminalStateKey(scope,
// id). Written by two producers: the per-connection classifier tap below while
// a browser is attached, and the unattended poller (terminal-poll.io.ts) for
// owned zellij sessions that have no bridge. GET /terminal/states lets a client
// that connects late render a chip immediately instead of waiting for the next
// transition.
const terminalStates = new Map<string, TerminalStateRecord>()

// Zellij session names with a live WS bridge right now, refcounted: React
// StrictMode double-mounts TerminalView and the daemon keeps the previous child
// for a 1s grace, so two bridges for one session name legitimately overlap and
// a plain Set would be released by whichever closed first. The poller reads
// these names to stay off terminals the bridge is already classifying
// byte-accurately.
const attachedSessions = new Map<string, number>()

const retainAttachedSession = (name: string | null): void => {
  if (name === null) return
  attachedSessions.set(name, (attachedSessions.get(name) ?? 0) + 1)
}

const releaseAttachedSession = (name: string | null): void => {
  if (name === null) return
  const remaining = (attachedSessions.get(name) ?? 0) - 1
  if (remaining > 0) attachedSessions.set(name, remaining)
  else attachedSessions.delete(name)
}

// The single writer for terminalStates + the terminal.state SSE event. Shared
// by the WS classifier tap and the unattended poller so the two producers can
// never drift on the record shape or forget to publish. `at` is stamped here —
// the poller's own pure fold has no clock.
const publishTerminalState = (input: {
  readonly scope: TerminalScope
  readonly id: string
  readonly state: TerminalStateSlug
  readonly matcher: string | undefined
  readonly evidence: string | undefined
}): void => {
  const record: TerminalStateRecord = { ...input, at: new Date().toISOString() }
  terminalStates.set(terminalStateKey({ scope: input.scope, id: input.id }), record)
  sseBus.publish({ type: "terminal.state", data: record })
}

// Trailing throttle for classification, distinct from the byte-forward path:
// a "thinking" spinner redraws several times a second (verified capture:
// roughly every 100-150ms), and running stripAnsi + the matcher table on
// every single chunk would burn CPU for no user-visible benefit — a state
// chip doesn't need to update faster than a human can read it. 400ms keeps
// the chip feeling live without turning every keystroke into a regex pass.
const TERMINAL_STATE_THROTTLE_MS = 400

// Rolling tail cap. Generous enough to outlive one full spinner/response
// cycle (the verified capture's longest single redraw run was under 2,000
// chars) without holding more than a fraction of a second's worth of scroll
// per connection.
const TERMINAL_STATE_TAIL_MAX_CHARS = 8_000

const idForScope = (args: { readonly scope: TerminalScope; readonly c: Context }): string => {
  if (args.scope === "global" || args.scope === "orchestrator") return args.scope
  return args.c.req.param("id") ?? ""
}

// Per-connection classifier state: a stateful TextDecoder (so a multi-byte
// UTF-8 character split across two pty reads decodes correctly instead of
// corrupting the tail with a stray replacement character), the rolling tail
// itself, the last published state (for decideTransition), and the pending
// throttle timer. Built once in onOpen and torn down in onClose alongside
// the rest of the bridge's per-connection resources.
const makeClassifierTap = (args: { readonly scope: TerminalScope; readonly id: string }) => {
  const decoder = new TextDecoder()
  let tail = ""
  let priorState: TerminalStateSlug | undefined
  let throttleTimer: ReturnType<typeof setTimeout> | undefined

  const publish = (): void => {
    throttleTimer = undefined
    const next = classifyTail({ tail })
    if (!decideTransition({ prior: priorState, next }).publish) return
    priorState = next.state
    publishTerminalState({
      scope: args.scope,
      id: args.id,
      state: next.state,
      matcher: next.matcher,
      evidence: next.evidence,
    })
  }

  return {
    // Called AFTER the WS send for the same chunk — classification is a
    // side-quest off the byte-forward path, never ahead of it.
    onChunk: (bytes: Uint8Array): void => {
      const chunk = decoder.decode(bytes, { stream: true })
      tail = appendTail({ tail, chunk, maxChars: TERMINAL_STATE_TAIL_MAX_CHARS })
      if (throttleTimer) return
      throttleTimer = setTimeout(publish, TERMINAL_STATE_THROTTLE_MS)
    },
    dispose: (): void => {
      if (throttleTimer) clearTimeout(throttleTimer)
    },
  }
}

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
  onChunk,
  signal,
}: {
  stream: ReadableStream<Uint8Array>
  send: (chunk: Uint8Array) => void
  // Called AFTER send() for the same chunk — a side-quest off the
  // byte-forward path (state classification today), never ahead of it.
  // Optional so pipeStream stays usable without a tap.
  onChunk?: (chunk: Uint8Array) => void
  signal: AbortSignal
}): Promise<void> => {
  const reader = stream.getReader()
  try {
    while (!signal.aborted) {
      const { value, done } = await reader.read()
      if (done) break
      if (value) {
        send(value)
        onChunk?.(value)
      }
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
  // Which terminal kind this handler serves — feeds the state-classifier
  // tap's scope/id (see makeClassifierTap) and GET /terminal/states.
  readonly scope: TerminalScope
}

const makeWsHandler = ({ resolveCommand, pty = false, scope }: BridgeOpts) =>
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
        const classifierTap = makeClassifierTap({ scope, id: idForScope({ scope, c }) })
        // Claim the zellij session for the byte-accurate path for as long as
        // this bridge lives; the poller leaves claimed sessions alone.
        retainAttachedSession(resolved.sessionName)
        bridges.set(tokenKey, {
          child,
          drainAbort,
          sizefile,
          sizedir,
          heartbeat,
          classifierDispose: classifierTap.dispose,
          sessionName: resolved.sessionName,
        })

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
        void pipeStream({
          stream: child.stdout,
          send,
          onChunk: classifierTap.onChunk,
          signal: drainAbort.signal,
        })
        void pipeStream({
          stream: child.stderr,
          send,
          onChunk: classifierTap.onChunk,
          signal: drainAbort.signal,
        })

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
        releaseAttachedSession(b.sessionName)
        clearInterval(b.heartbeat)
        b.classifierDispose()
        b.drainAbort.abort()
        void closeChildBridge({ child: b.child, sizedir: b.sizedir })
      },
    }
  })

// The prefix is resolved once (see platform/zellij-prefix.ts) before the five
// WS handlers below are constructed, then threaded through as plain data — a
// `zellijPrefix` field on each `make…Command` factory's args — rather than
// closed over as a module-level mutable. Every resolver takes it explicitly,
// so a test can exercise both the empty-prefix and the prefixed path by
// constructing a resolver with whatever prefix it likes, with no dependency on
// the ambient environment or on module re-import timing.

// The fields these resolvers read off a session. Declared structurally rather
// than importing the sessions slice's `SessionState`: the terminal slice needs
// a shape, not a dependency on another slice's internals, and a `SessionState`
// satisfies this as-is.
type TerminalSessionRef = {
  readonly short: string
  readonly cwd: string | undefined
  readonly sessionId: string | undefined
}

// Claude drill-in: wrap the session in a per-session zellij so the tab bar is
// visible and a second pane (tail logs, run tests) can live next to the claude
// TUI. The user runs `claude attach <short>` themselves — SessionCard exposes a
// copy button for the exact command. Pure (given the session + prefix) — no
// I/O — so it's exported and unit-tested directly.
export const resolveClaudeSession = (args: {
  readonly session: TerminalSessionRef
  readonly zellijPrefix: string
}): Resolved => {
  const { session, zellijPrefix } = args
  const cwd = session.cwd || process.env.HOME || "/"
  const rawSessionName = zellijSessionName(session.short)
  if (rawSessionName === null) return { ok: false, reason: "invalid_id" }
  const sessionName = prefixedZellijSession({ prefix: zellijPrefix, name: rawSessionName })
  const cmd = sessionZellijCommand({ cwd, sessionName, short: session.short })
  if (cmd === null) return { ok: false, reason: "invalid_id" }
  return { ok: true, cwd, cmd, sessionName }
}

// pi drill-in: attach the detached `pi-<short>` session the dispatcher created
// (or resurrect it by resuming the transcript if it has since died). Pure —
// exported and unit-tested directly, same shape as resolveClaudeSession.
export const resolvePiSession = (args: {
  readonly pi: TerminalSessionRef
  readonly zellijPrefix: string
}): Resolved => {
  const { pi, zellijPrefix } = args
  const cwd = pi.cwd || process.env.HOME || "/"
  const rawSessionName = piZellijSessionName(pi.short)
  const sessionName = prefixedZellijSession({ prefix: zellijPrefix, name: rawSessionName })
  // sessionId is the full uuid for a pi run; fall back to the short (a partial
  // uuid pi's `--session` also resolves) to keep the type total.
  const cmd = sessionPiZellijCommand({ cwd, sessionId: pi.sessionId || pi.short, sessionName })
  return { ok: true, cwd, cmd, sessionName }
}

type SessionLookup = (
  id: string,
) => Promise<{ readonly session?: TerminalSessionRef; readonly pi?: TerminalSessionRef }>

// A pi run lives in a separate registry (pi-spawns.json, not the claude
// roster) and inside its own `pi-<short>` zellij session. Look it up only
// when the claude registry misses, so a pi terminal attaches to a live run
// instead of failing with "session not found".
const defaultLookupSession: SessionLookup = (id) =>
  appRuntime.runPromise(
    Effect.gen(function* () {
      const reg = yield* SessionRegistry
      const piRepo = yield* PiSessionsIo
      const session = yield* Effect.promise(() => reg.getOne(id))
      return { session, pi: session ? undefined : piRepo.getOne(id) }
    }),
  )

// `lookupSession` is injected (defaulting to the real registries via
// appRuntime) so tests can drive both the prefixed and unprefixed session
// paths without touching the live SessionRegistry/PiSessionsIo — same
// dirExists-injection idiom resolveOrchestratorCwd already uses.
const makeResolveSessionCommand = (args: {
  readonly zellijPrefix: string
  readonly lookupSession?: SessionLookup
}) => {
  const lookupSession = args.lookupSession ?? defaultLookupSession
  return async (c: Context): Promise<Resolved> => {
    const id = c.req.param("id") ?? ""
    if (!id) return { ok: false, reason: "missing_id" }
    const { session, pi } = await lookupSession(id)
    if (session) return resolveClaudeSession({ session, zellijPrefix: args.zellijPrefix })
    if (pi) return resolvePiSession({ pi, zellijPrefix: args.zellijPrefix })
    return { ok: false, reason: `session ${id} not found` }
  }
}

// Dashboard global terminal: pinned to zellij session "default" (prefixed for
// a non-primary daemon). No id in the URL — there's exactly one of these per
// daemon. cwd defaults to $HOME so the user lands somewhere sensible the
// first time they open it.
const makeResolveGlobalCommand =
  (args: { readonly zellijPrefix: string }) =>
  async (_c: Context): Promise<Resolved> => {
    const cwd = globalTerminalCwd(process.env)
    const sessionName = prefixedZellijSession({
      prefix: args.zellijPrefix,
      name: GLOBAL_ZELLIJ_SESSION,
    })
    const cmd = projectZellijCommand({ cwd, sessionName })
    return { ok: true, cwd, cmd, sessionName }
  }

// Orchestrator terminal: pinned to the single zellij session named
// "Orchestrator" (prefixed for a non-primary daemon — worker hooks still
// target ORCHESTRATOR_ZELLIJ_SESSION verbatim, since voice-event.sh has no
// concept of a prefix; see that constant's own doc comment). No id in the
// URL — there's exactly one supervisor per daemon. cwd is the Orchestrator
// repo so its CLAUDE.md (the supervisor instructions) loads and the
// bootstrap's relative scripts/ resolve.
const makeResolveOrchestratorCommand =
  (args: { readonly zellijPrefix: string }) =>
  async (_c: Context): Promise<Resolved> => {
    // Bail before spawn if the repo dir is missing — spawning into a nonexistent
    // cwd throws synchronously and crashes the daemon. resolveOrchestratorCwd
    // returns a message the WS surfaces instead.
    const r = resolveOrchestratorCwd(process.env, (p) => existsSync(p))
    if (!r.ok) return { ok: false, reason: r.reason }
    const sessionName = prefixedZellijSession({
      prefix: args.zellijPrefix,
      name: ORCHESTRATOR_ZELLIJ_SESSION,
    })
    const cmd = orchestratorZellijCommand({ cwd: r.cwd, sessionName })
    return { ok: true, cwd: r.cwd, cmd, sessionName }
  }

type FindProject = (id: string) => Promise<Pick<Project, "path"> | undefined>

const defaultFindProject: FindProject = (id) =>
  appRuntime
    .runPromise(
      Effect.gen(function* () {
        const svc = yield* ProjectsService
        return yield* svc.list()
      }),
    )
    .then((projects) => projects.find((p) => p.id === id))

// `findProject` is injected (defaulting to the real ProjectsService via
// appRuntime) for the same reason lookupSession is above.
const makeResolveProjectCommand = (args: {
  readonly zellijPrefix: string
  readonly findProject?: FindProject
}) => {
  const findProject = args.findProject ?? defaultFindProject
  return async (c: Context): Promise<Resolved> => {
    const id = c.req.param("id") ?? ""
    if (!id) return { ok: false, reason: "missing_id" }
    const rawSessionName = zellijSessionName(id)
    if (!rawSessionName) return { ok: false, reason: "invalid_id" }
    const project = await findProject(id)
    if (!project) return { ok: false, reason: `project ${id} not found` }
    const sessionName = prefixedZellijSession({ prefix: args.zellijPrefix, name: rawSessionName })
    const cmd = projectZellijCommand({ cwd: project.path, sessionName })
    return { ok: true, cwd: project.path, cmd, sessionName }
  }
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

const resolveProjectKillName = (args: {
  readonly id: string
  readonly zellijPrefix: string
}): string | null => {
  const rawSessionName = zellijSessionName(args.id)
  if (!rawSessionName) return null
  return prefixedZellijSession({ prefix: args.zellijPrefix, name: rawSessionName })
}

const resolveSessionKillName = async (args: {
  readonly id: string
  readonly zellijPrefix: string
  readonly lookupSession?: SessionLookup
}): Promise<string | null> => {
  const lookupSession = args.lookupSession ?? defaultLookupSession
  const { session, pi } = await lookupSession(args.id)
  const rawSessionName = session
    ? zellijSessionName(session.short)
    : pi
      ? piZellijSessionName(pi.short)
      : null
  if (rawSessionName === null) return null
  return prefixedZellijSession({ prefix: args.zellijPrefix, name: rawSessionName })
}

const zellijPrefix = readZellijPrefix()

// --- unattended terminal state polling ---------------------------------------
//
// Everything below feeds terminal-poll.io.ts's ports. It lives here rather than
// in the poller because this module already owns the four name-derivation rules
// (and the prefix), already holds the shared terminalStates map, and already
// imports the registries a candidate list needs — so the poller stays a pure-ish
// scheduler over injected functions and the import arrow points one way.

// The two terminals with no id segment: one fixed zellij session each.
const fixedPollCandidates = (): ReadonlyArray<PollCandidate> => [
  {
    scope: "global",
    id: "global",
    sessionName: prefixedZellijSession({ prefix: zellijPrefix, name: GLOBAL_ZELLIJ_SESSION }),
  },
  {
    scope: "orchestrator",
    id: "orchestrator",
    sessionName: prefixedZellijSession({ prefix: zellijPrefix, name: ORCHESTRATOR_ZELLIJ_SESSION }),
  },
]

// A project terminal is a bare shell — precisely where a user runs `claude` by
// hand, which is the case terminal-state detection exists for.
const projectPollCandidates = async (): Promise<ReadonlyArray<PollCandidate>> => {
  const projects = await appRuntime.runPromise(Effect.flatMap(ProjectsService, (svc) => svc.list()))
  return projects.flatMap((project) => {
    const raw = zellijSessionName(project.id)
    if (raw === null) return []
    return [
      {
        scope: "project" as const,
        id: project.id,
        sessionName: prefixedZellijSession({ prefix: zellijPrefix, name: raw }),
      },
    ]
  })
}

// Claude drill-ins live in a zellij session named after the roster short; a
// dispatched pi run lives in `pi-<short>` (created detached by
// features/dispatch/pi.io.ts with `attach -b`, so until this poller existed
// nobody had ever classified one).
const sessionPollCandidates = async (): Promise<ReadonlyArray<PollCandidate>> => {
  const { shorts, piShorts } = await appRuntime.runPromise(
    Effect.gen(function* () {
      const registry = yield* SessionRegistry
      const piRepo = yield* PiSessionsIo
      const sessions = yield* Effect.promise(() => registry.snapshot())
      return { shorts: sessions.map((s) => s.short), piShorts: piRepo.list().map((p) => p.short) }
    }),
  )
  const claude = shorts.flatMap((short) => {
    const raw = zellijSessionName(short)
    if (raw === null) return []
    return [
      {
        scope: "session" as const,
        id: short,
        sessionName: prefixedZellijSession({ prefix: zellijPrefix, name: raw }),
      },
    ]
  })
  const pi = piShorts.map((short) => ({
    scope: "session" as const,
    id: short,
    sessionName: prefixedZellijSession({
      prefix: zellijPrefix,
      name: piZellijSessionName(short),
    }),
  }))
  return [...claude, ...pi]
}

const listPollCandidates = async (): Promise<ReadonlyArray<PollCandidate>> => {
  const [projects, sessions] = await Promise.all([projectPollCandidates(), sessionPollCandidates()])
  return [...fixedPollCandidates(), ...projects, ...sessions]
}

// Read-only `zellij` invocation: capture stdout, ignore stderr (an absent or
// just-died session writes a human message there and the empty stdout already
// says everything the caller acts on), never throw on a non-zero exit.
//
// Deliberately does NOT scrub the environment through cleanZellijEnv. That
// scrub exists because a daemon running inside a zellij pane leaks
// ZELLIJ_SESSION_NAME into a child, and `zellij attach` then panics on the
// nesting. These calls never attach: they name their target with an explicit
// `--session`, which was verified to work with a *different* session's
// ZELLIJ_SESSION_NAME still set in the environment.
const runZellijRead = async (argv: ReadonlyArray<string>): Promise<string> => {
  const proc = Bun.spawn([...argv], { stdout: "pipe", stderr: "ignore" })
  const text = await new Response(proc.stdout).text()
  await proc.exited
  return text
}

// Constructed at module load but INERT: no timer, no subprocess, until
// server.ts's startDaemon() calls start() with the configured interval. See
// terminal-poll.io.ts's header.
export const terminalPoller = createTerminalPoller({
  ports: {
    listCandidates: listPollCandidates,
    listSessions: () => runZellijRead(zellijListSessionsArgv()),
    listPanes: ({ sessionName }) => runZellijRead(zellijListPanesArgv({ sessionName })),
    dumpScreen: ({ sessionName, paneId }) =>
      runZellijRead(zellijDumpScreenArgv({ sessionName, paneId })),
    attachedSessionNames: () => [...attachedSessions.keys()],
    priorState: ({ key }) => terminalStates.get(key)?.state,
    publish: publishTerminalState,
    now: () => Date.now(),
  },
  tailMaxChars: TERMINAL_STATE_TAIL_MAX_CHARS,
})

const app = new Hono()
  .get(
    "/global",
    makeWsHandler({
      resolveCommand: makeResolveGlobalCommand({ zellijPrefix }),
      pty: true,
      scope: "global",
    }),
  )
  .get(
    "/orchestrator",
    makeWsHandler({
      resolveCommand: makeResolveOrchestratorCommand({ zellijPrefix }),
      pty: true,
      scope: "orchestrator",
    }),
  )
  .get(
    "/project/:id",
    makeWsHandler({
      resolveCommand: makeResolveProjectCommand({ zellijPrefix }),
      pty: true,
      scope: "project",
    }),
  )
  .delete("/global", async (c) =>
    c.json(
      await killZellijSession(
        prefixedZellijSession({ prefix: zellijPrefix, name: GLOBAL_ZELLIJ_SESSION }),
      ),
    ),
  )
  .delete("/orchestrator", async (c) =>
    c.json(
      await killZellijSession(
        prefixedZellijSession({ prefix: zellijPrefix, name: ORCHESTRATOR_ZELLIJ_SESSION }),
      ),
    ),
  )
  .delete("/project/:id", async (c) => {
    const id = c.req.param("id") ?? ""
    return c.json(await killZellijSession(resolveProjectKillName({ id, zellijPrefix })))
  })
  .delete("/:id", async (c) => {
    const id = c.req.param("id") ?? ""
    return c.json(await killZellijSession(await resolveSessionKillName({ id, zellijPrefix })))
  })
  // Current classification per known terminal — lets a client that connects
  // (or reconnects) late render a chip immediately instead of waiting for the
  // next transition. Registered ahead of the `/:id` catch-all below so a
  // terminal id can never literally be "states" and shadow this route.
  .get("/states", (c) => {
    // Refresh-on-read: a long-lived Bun daemon has lost every setInterval in
    // this process before while its sockets stayed alive, so the poller's timer
    // is not allowed to be the only thing keeping unattended state fresh. A
    // no-op unless polling is enabled AND the last pass is older than the
    // interval; fire-and-forget, so this response is the map as it stands and
    // the pass's results arrive over the terminal.state SSE event.
    terminalPoller.refreshIfStale()
    return c.json(Object.fromEntries(terminalStates))
  })
  .get(
    "/:id",
    makeWsHandler({
      resolveCommand: makeResolveSessionCommand({ zellijPrefix }),
      pty: true,
      scope: "session",
    }),
  )

export { app }
