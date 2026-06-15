import { Context, Data, Effect, Layer } from "effect"

export class ShellError extends Data.TaggedError("ShellError")<{
  readonly message: string
  readonly exitCode?: number
  readonly stderr?: string
  readonly cause?: unknown
}> {}

export type DispatchInput = {
  readonly intent: string
  readonly cwd?: string
  readonly agent?: string
  readonly permissionMode?: string
}

export type SendInput = {
  readonly id: string
  readonly keys: string
}

export type ShellRepoApi = {
  readonly dispatch: (input: DispatchInput) => Effect.Effect<string, ShellError>
  readonly stop: (id: string) => Effect.Effect<void, ShellError>
  readonly rm: (id: string) => Effect.Effect<void, ShellError>
  readonly peek: (id: string) => Effect.Effect<string, ShellError>
  readonly send: (input: SendInput) => Effect.Effect<void, ShellError>
}

export class ShellRepo extends Context.Tag("ShellRepo")<ShellRepo, ShellRepoApi>() {}

// Pick the cwd a dispatched session spawns in. An explicit cwd (e.g. a project
// path) wins; otherwise default sessions start in HOME so they land in the
// user's `~` rather than wherever the daemon process happens to run. Falls back
// to '/' when HOME is unset — Bun.spawn rejects an empty cwd.
export const resolveSpawnCwd = (
  cwd: string | undefined,
  env: Readonly<Record<string, string | undefined>>,
): string => {
  if (cwd && cwd.length > 0) return cwd
  const home = env.HOME
  if (home && home.length > 0) return home
  return "/"
}

const SHORT_RE = /backgrounded[^a-z0-9]+([a-z0-9]{4,})/i
// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI SGR escapes
const ANSI_RE = /\x1b\[[0-9;]*m/g

const stripAnsi = (s: string): string => s.replace(ANSI_RE, "")

const decodeText = (buf: ArrayBuffer | Uint8Array | string): string => {
  if (typeof buf === "string") return buf
  if (buf instanceof Uint8Array) return new TextDecoder().decode(buf)
  return new TextDecoder().decode(new Uint8Array(buf))
}

const readStream = async (stream: ReadableStream<Uint8Array> | null): Promise<string> => {
  if (!stream) return ""
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    if (value) chunks.push(value)
  }
  let total = 0
  for (const c of chunks) total += c.byteLength
  const out = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) {
    out.set(c, offset)
    offset += c.byteLength
  }
  return decodeText(out)
}

type SpawnOpts = {
  readonly cmd: readonly string[]
  readonly cwd?: string
  readonly timeoutMs?: number
}

const runClaude = ({
  cmd,
  cwd,
  timeoutMs = 30_000,
}: SpawnOpts): Effect.Effect<{ stdout: string; stderr: string }, ShellError> =>
  Effect.tryPromise({
    try: async () => {
      const proc = Bun.spawn({
        cmd: [...cmd],
        cwd,
        stdout: "pipe",
        stderr: "pipe",
        stdin: "ignore",
      })
      const timer = setTimeout(() => {
        try {
          proc.kill()
        } catch {
          // ignore — already exited
        }
      }, timeoutMs)
      const [stdout, stderr] = await Promise.all([readStream(proc.stdout), readStream(proc.stderr)])
      const exitCode = await proc.exited
      clearTimeout(timer)
      if (exitCode !== 0) {
        throw new ShellError({
          message: `command failed: ${cmd.join(" ")}`,
          exitCode,
          stderr,
        })
      }
      return { stdout, stderr }
    },
    catch: (cause) =>
      cause instanceof ShellError
        ? cause
        : new ShellError({ message: `spawn failed: ${cmd.join(" ")}`, cause }),
  })

const parseShort = (stdout: string): string | null => {
  for (const line of stripAnsi(stdout).split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const match = SHORT_RE.exec(trimmed)
    if (match?.[1]) return match[1]
  }
  return null
}

const buildDispatchArgs = ({ intent, agent, permissionMode }: DispatchInput): string[] => {
  const args: string[] = ["claude", "--bg"]
  if (agent) args.push("--agent", agent)
  if (permissionMode) args.push("--permission-mode", permissionMode)
  args.push(intent)
  return args
}

// Persistent attach pool. `claude attach` accepts keys via stdin; the TUI
// renders to stdout. We keep one Bun.spawn("claude attach", id) alive per
// session so subsequent /send calls skip the ~1.5s boot — only the first
// pays it. node-pty's prebuilt binding silently drops onData under Bun 1.3+
// so we use piped stdio and drain stdout to keep the pipe from filling.
// Concurrent sends to the same session are serialized through a per-entry
// promise chain; sends to different sessions run in parallel. Idle attaches
// are evicted (Ctrl+Z + kill) after ATTACH_IDLE_MS so we don't pin RAM for
// sessions the user has stopped chatting with.
const ATTACH_BOOT_MS = 1_500
const ATTACH_HOLD_MS = 300
const ATTACH_IDLE_MS = 5 * 60_000
const ATTACH_DETACH_WAIT_MS = 1_500
const DETACH_KEY = "\x1a" // Ctrl+Z — documented by `claude attach`.

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

type AttachChild = Bun.Subprocess<"pipe", "pipe", "pipe">

type AttachEntry = {
  child: AttachChild
  idleTimer: ReturnType<typeof setTimeout>
  lock: Promise<void>
}

const pool = new Map<string, AttachEntry>()

const drain = (stream: ReadableStream<Uint8Array> | null): void => {
  if (!stream) return
  const reader = stream.getReader()
  const loop = async () => {
    try {
      while (true) {
        const { done } = await reader.read()
        if (done) break
      }
    } catch {
      // ignore — stream closed
    }
  }
  void loop()
}

const evict = async (short: string): Promise<void> => {
  const entry = pool.get(short)
  if (!entry) return
  pool.delete(short)
  clearTimeout(entry.idleTimer)
  try {
    entry.child.stdin.write(DETACH_KEY)
    entry.child.stdin.flush()
  } catch {
    // stdin already closed
  }
  await Promise.race([entry.child.exited, sleep(ATTACH_DETACH_WAIT_MS)])
  try {
    entry.child.kill()
  } catch {
    // already exited
  }
}

const spawnAttach = (short: string): AttachEntry => {
  const child: AttachChild = Bun.spawn(["claude", "attach", short], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      TERM: "xterm-256color",
      COLUMNS: "120",
      LINES: "32",
    },
  })
  drain(child.stdout)
  drain(child.stderr)
  const entry: AttachEntry = {
    child,
    idleTimer: setTimeout(() => void evict(short), ATTACH_IDLE_MS),
    lock: sleep(ATTACH_BOOT_MS),
  }
  void child.exited.then(() => {
    if (pool.get(short) === entry) {
      clearTimeout(entry.idleTimer)
      pool.delete(short)
    }
  })
  return entry
}

const sendViaPool = ({ id, keys }: SendInput): Effect.Effect<void, ShellError> =>
  Effect.tryPromise({
    try: async () => {
      let entry = pool.get(id)
      if (!entry || entry.child.exitCode !== null) {
        entry = spawnAttach(id)
        pool.set(id, entry)
      }
      const e = entry
      const job = e.lock.then(async () => {
        e.child.stdin.write(keys)
        e.child.stdin.flush()
        await sleep(ATTACH_HOLD_MS)
        clearTimeout(e.idleTimer)
        e.idleTimer = setTimeout(() => void evict(id), ATTACH_IDLE_MS)
      })
      e.lock = job.catch(() => undefined)
      await job
    },
    catch: (cause) => new ShellError({ message: `pty send failed for ${id}`, cause }),
  })

const evictAll = (): void => {
  for (const id of Array.from(pool.keys())) void evict(id)
}
process.on("SIGTERM", evictAll)
process.on("SIGINT", evictAll)
process.on("beforeExit", evictAll)

export const ShellRepoLive: Layer.Layer<ShellRepo> = Layer.succeed(ShellRepo, {
  dispatch: (input) =>
    Effect.gen(function* () {
      const args = buildDispatchArgs(input)
      const cwd = resolveSpawnCwd(input.cwd, process.env)
      const { stdout } = yield* runClaude({ cmd: args, cwd })
      const short = parseShort(stdout)
      if (!short) {
        return yield* Effect.fail(
          new ShellError({
            message: "could not parse short id from claude --bg stdout",
            stderr: stdout,
          }),
        )
      }
      return short
    }),
  stop: (id) => runClaude({ cmd: ["claude", "stop", id] }).pipe(Effect.asVoid),
  rm: (id) => runClaude({ cmd: ["claude", "rm", id] }).pipe(Effect.asVoid),
  peek: (id) =>
    runClaude({ cmd: ["claude", "peek", id], timeoutMs: 60_000 }).pipe(
      Effect.map(({ stdout }) => stdout.trim()),
    ),
  send: sendViaPool,
})
