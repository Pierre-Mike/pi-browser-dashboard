#!/usr/bin/env bun
/**
 * Functional probe for eval asserts: boot the real daemon, drive real traffic
 * against it, print the last response body on stdout, exit non-zero when an
 * expectation misses.
 *
 * Grepping a diff proves an agent typed the right words; this proves the feature
 * actually runs. Every task assert that says "responds 200 with …" goes through
 * here, so a slice that type-checks but 500s scores zero.
 *
 * Usage (see evals/tasks.jsonl for live examples):
 *   bun evals/probe.ts --path /health --expect-status 200
 *   bun evals/probe.ts --steps '[{"method":"POST","path":"/checkpoints",
 *                                "body":{"label":"x"},"expectStatus":201},
 *                               {"path":"/checkpoints"}]'
 *   bun evals/probe.ts --path /ticker/stream --read-ms 1500 --expect-match-count 'data:=2'
 *   bun evals/probe.ts --ws /echo/socket --ws-send hello --read-ms 800 --expect-match '"echo"'
 *
 * Flags: --path --method --body --header 'K: V' --env K=V --expect-status
 *        200[,201] --expect-header 'k=substring' --expect-match TEXT
 *        --expect-match-count 'TEXT=N' --read-ms N (stream mode) --wait-ms N
 *        --steps JSON --ws PATH --ws-send TEXT --config-dir DIR
 *        --daemon-entry PATH --boot-timeout-ms N
 *
 * `{{0.id}}` inside a later step's path or body string interpolates step 0's
 * JSON response field, so a create -> patch chain is one invocation.
 *
 * Two things this probe does NOT do, deliberately:
 *
 * - **It never picks a port.** The daemon is booted with `PORT=0` (its own
 *   documented "let the OS pick" path) and the probe reads the bound port back
 *   off the `daemon up: …` boot line. A probe that chose its own port could
 *   collide with a developer's dev daemon (8787), with `apps/web` (5173), or
 *   with `apps/e2e`'s fixed 18787/15173 — and e2e's global-setup hard-fails when
 *   its ports are taken, so a stray eval would break an unrelated test run.
 * - **It never touches the developer's state.** Every boot gets a throwaway
 *   `CLAUDE_CONFIG_DIR` and projects root, a unique `PID_ZELLIJ_PREFIX` (so the
 *   daemon cannot attach to, or name, a real zellij session), and the tunnel,
 *   issue poll, rules tick and terminal poll are all off. `--config-dir` opts
 *   into a *shared* config dir so two invocations can prove durability across a
 *   daemon restart.
 */
import { mkdirSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Glob } from "bun"
import type { Json } from "./probe.core"
import {
  bodyMismatches,
  headerMismatch,
  interpolate,
  interpolateJson,
  parseBoundPort,
  parseEnvFlag,
  parseHeaderExpectation,
  parseHeaderFlag,
  parseStatuses,
  statusAllowed,
} from "./probe.core"

interface Step {
  readonly method?: string
  readonly path?: string
  readonly body?: Json
  readonly headers?: Record<string, string>
  readonly expectStatus?: number | ReadonlyArray<number>
}

const argv = Bun.argv.slice(2)

const flagValues = (name: string): ReadonlyArray<string> =>
  argv.flatMap((arg, index) => (arg === `--${name}` ? [argv[index + 1] ?? ""] : []))

const flag = (name: string): string | undefined => flagValues(name).at(-1)

const numberFlag = (input: { readonly name: string; readonly fallback: number }): number => {
  const raw = flag(input.name)
  const parsed = raw === undefined ? Number.NaN : Number(raw)
  return Number.isFinite(parsed) ? parsed : input.fallback
}

const fail = (message: string): never => {
  console.error(`probe: ${message}`)
  process.exit(1)
}

const parseJsonFlag = (input: { readonly name: string; readonly raw: string }): Json => {
  try {
    return JSON.parse(input.raw)
  } catch (cause) {
    return fail(`--${input.name} is not valid JSON: ${String(cause)}`)
  }
}

const parseJsonOrUndefined = (text: string): Json => {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

// --- the daemon under test --------------------------------------------------

/**
 * Discovered by shape, not by path: the composition root is whichever
 * `apps/*​/src/main.ts` boots the daemon. A hardcoded `apps/daemon/...` would
 * quietly stop working the moment a rename task moved the app — and reporting a
 * boot failure as a feature failure is exactly the kind of false signal this
 * grid exists to avoid.
 */
const findDaemonEntry = async (): Promise<string> => {
  const explicit = flag("daemon-entry")
  if (explicit !== undefined) return explicit
  for (const rel of new Glob("apps/*/src/main.ts").scanSync(".")) {
    const text = await Bun.file(rel).text()
    if (text.includes("startDaemon")) return rel
  }
  return fail("could not find the daemon entrypoint (apps/*/src/main.ts importing startDaemon)")
}

const envOverrides = (): Record<string, string> =>
  Object.fromEntries(flagValues("env").map((pair) => parseEnvFlag(pair)))

/**
 * A sandbox the daemon can be pointed at with no chance of touching the
 * developer's real dashboard state. `--config-dir` reuses one across
 * invocations, which is how a task proves its writes survive a restart.
 */
const sandboxDirs = (): { readonly configDir: string; readonly projectsRoot: string } => {
  const shared = flag("config-dir")
  const base = shared ?? mkdtempSync(join(tmpdir(), "eval-probe-"))
  const configDir = join(base, "claude")
  const projectsRoot = join(base, "projects")
  mkdirSync(configDir, { recursive: true })
  mkdirSync(projectsRoot, { recursive: true })
  return { configDir, projectsRoot }
}

const sandbox = sandboxDirs()

const daemonEnv = (): Record<string, string> => ({
  ...Bun.env,
  // 0 = let the OS pick; the bound port comes back on the boot line.
  PORT: "0",
  NODE_ENV: "test",
  CLAUDE_CONFIG_DIR: sandbox.configDir,
  PID_PROJECTS_ROOT: sandbox.projectsRoot,
  PID_ORCHESTRATOR_DIR: sandbox.projectsRoot,
  // Never attach to, or create, a zellij session a human is using.
  PID_ZELLIJ_PREFIX: `eval-${Bun.nanoseconds().toString(36)}-`,
  PID_TUNNEL_AUTOSTART: "0",
  PID_ISSUE_POLL_MS: "0",
  PID_RULES_TICK_MS: "0",
  PID_TERMINAL_POLL_MS: "0",
  ...envOverrides(),
})

const entry = await findDaemonEntry()
const daemon = Bun.spawn(["bun", entry], {
  env: daemonEnv(),
  stdout: "pipe",
  stderr: "pipe",
  stdin: "ignore",
})

let daemonAlive = true
void daemon.exited.then(() => {
  daemonAlive = false
})

/**
 * Drain both pipes continuously. Two reasons, and the second one bites: the
 * boot line (and therefore the port) is *in* stderr, and a full pipe buffer
 * would block the daemon mid-request once it had logged a few KB.
 */
let logged = ""
const drainInto = async (stream: ReadableStream<Uint8Array> | null): Promise<void> => {
  if (stream === null) return
  const decoder = new TextDecoder()
  const reader = stream.getReader()
  for (;;) {
    const chunk = await reader.read().catch(() => ({ done: true, value: undefined }))
    if (chunk.done) return
    logged += decoder.decode(chunk.value, { stream: true })
  }
}
void drainInto(daemon.stderr)
void drainInto(daemon.stdout)

const shutdown = async (): Promise<void> => {
  daemon.kill()
  await daemon.exited.catch(() => undefined)
}

const failWithLog = async (message: string): Promise<never> => {
  await shutdown()
  return fail(`${message}\n--- daemon output ---\n${logged.slice(-2000)}`)
}

const waitForPort = async (timeoutMs: number): Promise<number> => {
  const deadline = Bun.nanoseconds() + timeoutMs * 1e6
  while (Bun.nanoseconds() < deadline) {
    const port = parseBoundPort(logged)
    if (port !== null) return port
    if (!daemonAlive) return failWithLog("daemon exited during boot")
    await Bun.sleep(50)
  }
  return failWithLog(`daemon did not print its bound port within ${timeoutMs}ms`)
}

const port = await waitForPort(numberFlag({ name: "boot-timeout-ms", fallback: 60_000 }))
const origin = `http://127.0.0.1:${port}`

// --- expectations ----------------------------------------------------------

const checkStatus = (input: {
  readonly actual: number
  readonly allowed: ReadonlyArray<number>
}): void => {
  if (statusAllowed(input)) return
  fail(`final response: expected status ${input.allowed.join("|")}, got ${input.actual}`)
}

const checkHeaders = (response: Response): void => {
  for (const expectation of flagValues("expect-header")) {
    const { name } = parseHeaderExpectation(expectation)
    const message = headerMismatch({ expectation, actual: response.headers.get(name) ?? "" })
    if (message !== null) fail(message)
  }
}

const checkBody = (text: string): void => {
  const messages = bodyMismatches({
    text,
    contains: flagValues("expect-match"),
    counts: flagValues("expect-match-count"),
  })
  const first = messages.at(0)
  if (first !== undefined) fail(first)
}

const drain = async (input: {
  readonly reader: ReadableStreamDefaultReader<Uint8Array>
}): Promise<string> => {
  const decoder = new TextDecoder()
  let text = ""
  for (;;) {
    const chunk = await input.reader.read().catch(() => ({ done: true, value: undefined }))
    if (chunk.done) return text
    text += decoder.decode(chunk.value, { stream: true })
  }
}

/** Stream mode: read for `--read-ms`, then cancel. An SSE stream never ends. */
const readForMs = async (input: {
  readonly response: Response
  readonly ms: number
}): Promise<string> => {
  const body = input.response.body
  if (body === null) return ""
  const reader = body.getReader()
  const stop = setTimeout(() => {
    void reader.cancel().catch(() => undefined)
  }, input.ms)
  const text = await drain({ reader })
  clearTimeout(stop)
  return text
}

const headerFlags = (): Record<string, string> =>
  Object.fromEntries(flagValues("header").map((raw) => parseHeaderFlag(raw)))

// --- websocket mode --------------------------------------------------------

/**
 * The other streaming surface this repo ships. `--ws /path` connects through
 * the daemon's shared Hono+Bun WS handler, sends every `--ws-send`, collects
 * frames for `--read-ms`, and hands the concatenation to the same body
 * expectations the HTTP path uses.
 */
const readWebSocket = (input: { readonly path: string; readonly ms: number }): Promise<string> =>
  new Promise<string>((resolve) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}${input.path}`)
    let received = ""
    let settled = false
    const finish = (): void => {
      if (settled) return
      settled = true
      socket.close()
      resolve(received)
    }
    const stop = setTimeout(finish, input.ms)
    socket.addEventListener("open", () => {
      for (const message of flagValues("ws-send")) socket.send(message)
    })
    socket.addEventListener("message", (event: MessageEvent) => {
      received += typeof event.data === "string" ? event.data : "<binary>"
      received += "\n"
    })
    socket.addEventListener("error", () => {
      clearTimeout(stop)
      finish()
    })
  })

// --- main ------------------------------------------------------------------

const defaultMethod = (bodyRaw: string | undefined): string =>
  bodyRaw === undefined ? "GET" : "POST"

const singleStep = (): Step => {
  const bodyRaw = flag("body")
  return {
    method: flag("method") ?? defaultMethod(bodyRaw),
    path: flag("path") ?? "/health",
    body: bodyRaw === undefined ? undefined : parseJsonFlag({ name: "body", raw: bodyRaw }),
  }
}

const parseSteps = (): ReadonlyArray<Step> => {
  const raw = flag("steps")
  if (raw === undefined) return [singleStep()]
  const parsed = parseJsonFlag({ name: "steps", raw })
  if (!Array.isArray(parsed)) return fail("--steps must be an array")
  return parsed.map((entry) => (typeof entry === "object" && entry !== null ? entry : {}))
}

const stepStatuses = (step: Step): ReadonlyArray<number> => {
  const expected = step.expectStatus
  if (expected === undefined) return []
  return typeof expected === "number" ? [expected] : expected
}

const waitMs = numberFlag({ name: "wait-ms", fallback: 0 })
if (waitMs > 0) await Bun.sleep(waitMs)

const readMs = numberFlag({ name: "read-ms", fallback: 0 })
const wsPath = flag("ws")

/** One step, with `{{0.field}}` tokens resolved against earlier responses. */
interface Resolved {
  readonly url: string
  readonly method: string
  readonly path: string
  readonly headers: Record<string, string>
  readonly body: string | undefined
}

const stepBody = (input: {
  readonly step: Step
  readonly responses: ReadonlyArray<Json>
}): string | undefined =>
  input.step.body === undefined
    ? undefined
    : JSON.stringify(interpolateJson({ value: input.step.body, responses: input.responses }))

const stepHeaders = (input: {
  readonly step: Step
  readonly hasBody: boolean
}): Record<string, string> => ({
  ...(input.hasBody ? { "content-type": "application/json" } : {}),
  ...headerFlags(),
  ...(input.step.headers ?? {}),
})

const resolveStep = (input: {
  readonly step: Step
  readonly responses: ReadonlyArray<Json>
}): Resolved => {
  const path = interpolate({ text: input.step.path ?? "/health", responses: input.responses })
  const body = stepBody(input)
  return {
    url: `${origin}${path}`,
    path,
    method: (input.step.method ?? "GET").toUpperCase(),
    headers: stepHeaders({ step: input.step, hasBody: body !== undefined }),
    body,
  }
}

const send = async (resolved: Resolved): Promise<Response> =>
  Bun.fetch(resolved.url, {
    method: resolved.method,
    headers: resolved.headers,
    body: resolved.body,
    // A stream is read for --read-ms and then cancelled, so it must not be
    // racing an overall request timeout.
    signal: readMs > 0 ? undefined : AbortSignal.timeout(30_000),
  }).catch((cause: unknown) =>
    failWithLog(`${resolved.method} ${resolved.path} failed: ${String(cause)}`),
  )

const requireStepStatus = async (input: {
  readonly response: Response
  readonly step: Step
  readonly resolved: Resolved
  readonly index: number
}): Promise<void> => {
  const allowed = stepStatuses(input.step)
  if (statusAllowed({ actual: input.response.status, allowed })) return
  const preview = await input.response.text().catch(() => "")
  await failWithLog(
    `step ${input.index} ${input.resolved.method} ${input.resolved.path}: expected ${allowed.join("|")}, got ${input.response.status} — ${preview.slice(0, 300)}`,
  )
}

const bodyOf = async (response: Response): Promise<string> =>
  readMs > 0 ? readForMs({ response, ms: readMs }) : response.text()

const runHttp = async (): Promise<string> => {
  const responses: Json[] = []
  let lastText = ""
  let lastResponse: Response | undefined
  for (const [index, step] of parseSteps().entries()) {
    const resolved = resolveStep({ step, responses })
    const response = await send(resolved)
    await requireStepStatus({ response, step, resolved, index })
    lastResponse = response
    lastText = await bodyOf(response)
    responses.push(parseJsonOrUndefined(lastText))
  }
  if (lastResponse !== undefined) {
    checkStatus({ actual: lastResponse.status, allowed: parseStatuses(flag("expect-status")) })
    checkHeaders(lastResponse)
  }
  return lastText
}

const text =
  wsPath === undefined
    ? await runHttp()
    : await readWebSocket({ path: wsPath, ms: readMs > 0 ? readMs : 1000 })

checkBody(text)
await shutdown()
await Bun.write(Bun.stdout, text.endsWith("\n") ? text : `${text}\n`)
