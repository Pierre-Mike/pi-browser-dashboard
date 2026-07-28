#!/usr/bin/env bun
// pid — an agent-facing CLI over the pi-browser-dashboard daemon's session
// control surface (see AGENTS.md "Single-package CLI distribution"). This is
// the thin imperative shell: read argv/env/clock, probe the daemon, drive the
// typed `hc` client, print, and exit with the code agent.core.ts decided.
// Every decision (parsing, exit codes, formatting, response parsing) lives in
// agent.core.ts — this file only wires I/O to it.
import type { AppType } from "@pid/daemon/types"
import { Either } from "effect"
import { hc } from "hono/client"
import {
  buildDispatchRequestBody,
  buildKeysRequestBody,
  buildSendRequestBody,
  buildWaitRequestBody,
  type Command,
  type ExitCode,
  errorMessageFrom,
  exitCodeForOutcome,
  exitCodeForUsage,
  exitCodeForWaitBody,
  filterByState,
  formatExplain,
  formatKeysSent,
  formatRemoved,
  formatSent,
  formatSessions,
  formatSpawned,
  formatStopped,
  formatWaitOutcome,
  type HelpCommand,
  NAMED_KEYS_HELP,
  type ParseError,
  parseAgentArgv,
  parseDispatchResponse,
  parseExplainResponse,
  parseKeysResponse,
  parseOkShortResponse,
  parseSendResponse,
  parseSessionsResponse,
  parseWaitOutcomeBody,
  resolveApiBase,
  resolveBaseUrl,
  type SessionListEntry,
  type SessionRow,
  type WaitOutcomeBody,
  type WaitParams,
  worstExitCode,
} from "./agent.core"

const HELP = `pid — agent-facing CLI over the pi-browser-dashboard daemon

Usage:
  pid sessions [--state <slug,...>] [--json]
  pid explain <short> [--json]
  pid wait <short> --until <slug,...> [--timeout <ms>] [--json]
  pid send <short> <text...> [--wait <slug,...>] [--timeout <ms>] [--json]
  pid keys <short> <name...> [--wait <slug,...>] [--timeout <ms>] [--json]
  pid spawn <intent> [--n <count>] [--agent <name>] [--cwd <path>] [--wait <slug,...>] [--json]
  pid stop <short>
  pid rm <short>
  pid [--help] [--url <base>]

--json is accepted on every command (a superset of the table above) and
prints the daemon's own response verbatim; without it, output is formatted
for a human. --url and --help/-h are recognised anywhere in the invocation.
PID_URL overrides the default http://localhost:8787; --url overrides PID_URL.

session states: done, working, blocked, needs_input, idle, failed, stopped, unknown
key names: ${NAMED_KEYS_HELP}

Exit codes:
  0  success / wait satisfied
  1  transport failure, 5xx, unreachable daemon, or an unparseable response
  2  usage error
  3  wait timed out
  4  occupant_changed — the session was replaced under the wait
  5  removed — the session went away
  6  not found
`

// biome-ignore lint/suspicious/noExplicitAny: hc client typing depends on daemon AppType resolution (see apps/web/src/lib/api.ts call sites)
type AnyClient = any

const readJson = async (res: Response): Promise<unknown> => {
  try {
    return await res.json()
  } catch {
    return undefined
  }
}

const outcomeForStatus = (res: Response): { readonly _tag: "NotFound" | "HttpError" } => ({
  _tag: res.status === 404 ? "NotFound" : "HttpError",
})

// Shared by every handler below: log and translate a non-2xx response into
// its exit code, or `undefined` when the response was fine. Factored out
// once so the identical "log the daemon's own error, map the status" shape
// exists in exactly one place rather than once per command.
const checkOk = ({
  res,
  body,
  label,
}: {
  readonly res: Response
  readonly body: unknown
  readonly label: string
}): ExitCode | undefined => {
  if (res.ok) return undefined
  console.error(`${label}: ${errorMessageFrom(body)}`)
  return exitCodeForOutcome(outcomeForStatus(res))
}

const shortOf = (item: unknown): string | undefined => {
  if (typeof item !== "object" || item === null) return undefined
  const { short } = item as { short?: unknown }
  return typeof short === "string" ? short : undefined
}

// Probes the daemon's bare `/health` — true selects the bare API base (dev
// daemon layout), false assumes the `pid-dashboard` single-port `/__api`
// layout without a second probe (see resolveApiBase's doc comment: a failed
// probe there just delays the same failure the real request would report).
const probeBare = async (url: string): Promise<boolean> => {
  const probeClient: AnyClient = hc<AppType>(url)
  try {
    const res: Response = await probeClient.health.$get()
    return res.ok
  } catch {
    return false
  }
}

const toSessionRow = (e: SessionListEntry): SessionRow => ({
  short: e.short,
  state: e.state,
  intent: e.intent,
  createdAtMs: e.createdAt === undefined ? undefined : Date.parse(e.createdAt),
})

// Verbatim means every original field, not just the ones this CLI parses —
// filter the RAW array by the shorts that survived the --state filter,
// rather than re-serializing the trimmed SessionListEntry values.
const printSessionsJson = ({
  body,
  filtered,
}: {
  readonly body: unknown
  readonly filtered: ReadonlyArray<SessionListEntry>
}): void => {
  const rawArray = Array.isArray(body) ? body : []
  const keep = new Set(filtered.map((e) => e.short))
  console.log(JSON.stringify(rawArray.filter((item) => keep.has(shortOf(item) ?? ""))))
}

const runSessions = async ({
  client,
  command,
}: {
  readonly client: AnyClient
  readonly command: Extract<Command, { readonly _tag: "Sessions" }>
}): Promise<ExitCode> => {
  const res: Response = await client.sessions.$get()
  const body = await readJson(res)
  const notOk = checkOk({ res, body, label: "sessions" })
  if (notOk !== undefined) return notOk
  const parsed = parseSessionsResponse(body)
  if (Either.isLeft(parsed)) {
    console.error(`sessions: ${parsed.left.message}`)
    return exitCodeForOutcome({ _tag: "HttpError" })
  }
  const filtered = filterByState({ items: parsed.right, states: command.state })
  if (command.json) {
    printSessionsJson({ body, filtered })
    return 0
  }
  console.log(formatSessions({ sessions: filtered.map(toSessionRow), now: Date.now() }))
  return 0
}

const runExplain = async ({
  client,
  command,
}: {
  readonly client: AnyClient
  readonly command: Extract<Command, { readonly _tag: "Explain" }>
}): Promise<ExitCode> => {
  const res: Response = await client.sessions[":id"].explain.$get({ param: { id: command.short } })
  const body = await readJson(res)
  const notOk = checkOk({ res, body, label: "explain" })
  if (notOk !== undefined) return notOk
  if (command.json) {
    console.log(JSON.stringify(body))
    return 0
  }
  const parsed = parseExplainResponse(body)
  if (Either.isLeft(parsed)) {
    console.error(`explain: ${parsed.left.message}`)
    return exitCodeForOutcome({ _tag: "HttpError" })
  }
  console.log(formatExplain(parsed.right))
  return 0
}

// Shared by wait/send/keys/stop/rm below: once the response parsed cleanly,
// either print the daemon's own JSON verbatim or the human formatting, and
// resolve the exit code from the parsed value. Factored out once so this
// exact "log the ParseError, else print-and-resolve" shape lives in one
// place rather than once per command (see `checkOk` above for its sibling).
const printAndExit = <T>({
  body,
  json,
  parsed,
  label,
  format,
  exitCodeFor,
}: {
  readonly body: unknown
  readonly json: boolean
  readonly parsed: Either.Either<T, ParseError>
  readonly label: string
  readonly format: (value: T) => string
  readonly exitCodeFor: (value: T) => ExitCode
}): ExitCode => {
  if (Either.isLeft(parsed)) {
    console.error(`${label}: ${parsed.left.message}`)
    return exitCodeForOutcome({ _tag: "HttpError" })
  }
  if (json) console.log(JSON.stringify(body))
  else console.log(format(parsed.right))
  return exitCodeFor(parsed.right)
}

const runWait = async ({
  client,
  command,
}: {
  readonly client: AnyClient
  readonly command: Extract<Command, { readonly _tag: "Wait" }>
}): Promise<ExitCode> => {
  const res: Response = await client.sessions[":id"].wait.$post({
    param: { id: command.short },
    json: buildWaitRequestBody({ until: command.until, timeoutMs: command.timeoutMs }),
  })
  const body = await readJson(res)
  const notOk = checkOk({ res, body, label: "wait" })
  if (notOk !== undefined) return notOk
  return printAndExit({
    body,
    json: command.json,
    parsed: parseWaitOutcomeBody(body),
    label: "wait",
    format: formatWaitOutcome,
    exitCodeFor: exitCodeForWaitBody,
  })
}

const runSend = async ({
  client,
  command,
}: {
  readonly client: AnyClient
  readonly command: Extract<Command, { readonly _tag: "Send" }>
}): Promise<ExitCode> => {
  const res: Response = await client.sessions[":id"].send.$post({
    param: { id: command.short },
    json: buildSendRequestBody({ keys: command.text, wait: command.wait }),
  })
  const body = await readJson(res)
  const notOk = checkOk({ res, body, label: "send" })
  if (notOk !== undefined) return notOk
  return printAndExit({
    body,
    json: command.json,
    parsed: parseSendResponse(body),
    label: "send",
    format: formatSent,
    exitCodeFor: (v) => exitCodeForOutcome({ _tag: "Ok", wait: v.wait }),
  })
}

const runKeys = async ({
  client,
  command,
}: {
  readonly client: AnyClient
  readonly command: Extract<Command, { readonly _tag: "Keys" }>
}): Promise<ExitCode> => {
  const res: Response = await client.sessions[":id"].keys.$post({
    param: { id: command.short },
    json: buildKeysRequestBody({ names: command.names, wait: command.wait }),
  })
  const body = await readJson(res)
  const notOk = checkOk({ res, body, label: "keys" })
  if (notOk !== undefined) return notOk
  return printAndExit({
    body,
    json: command.json,
    parsed: parseKeysResponse(body),
    label: "keys",
    format: formatKeysSent,
    exitCodeFor: (v) => exitCodeForOutcome({ _tag: "Ok", wait: v.wait }),
  })
}

// Shared by `stop` and `rm` — both are `POST /sessions/:id/<path>` returning
// `{ ok, short }`.
const runOkShortCommand = async ({
  client,
  command,
  path,
  format,
}: {
  readonly client: AnyClient
  readonly command: { readonly short: string; readonly json: boolean }
  readonly path: "stop" | "rm"
  readonly format: (short: string) => string
}): Promise<ExitCode> => {
  const res: Response = await client.sessions[":id"][path].$post({ param: { id: command.short } })
  const body = await readJson(res)
  const notOk = checkOk({ res, body, label: path })
  if (notOk !== undefined) return notOk
  return printAndExit({
    body,
    json: command.json,
    parsed: parseOkShortResponse(body),
    label: path,
    format: (v) => format(v.short),
    exitCodeFor: () => 0,
  })
}

type DispatchOneResult =
  | { readonly _tag: "Failed"; readonly code: ExitCode; readonly body: unknown }
  | { readonly _tag: "Dispatched"; readonly short: string }

const dispatchOne = async ({
  client,
  command,
}: {
  readonly client: AnyClient
  readonly command: Extract<Command, { readonly _tag: "Spawn" }>
}): Promise<DispatchOneResult> => {
  const res: Response = await client.dispatch.$post({
    json: buildDispatchRequestBody({
      intent: command.intent,
      cwd: command.cwd,
      agent: command.agent,
    }),
  })
  const body = await readJson(res)
  const notOk = checkOk({ res, body, label: "spawn" })
  if (notOk !== undefined) return { _tag: "Failed", code: notOk, body }
  const dispatched = parseDispatchResponse(body)
  if (Either.isLeft(dispatched)) {
    console.error(`spawn: ${dispatched.left.message}`)
    return { _tag: "Failed", code: exitCodeForOutcome({ _tag: "HttpError" }), body }
  }
  return { _tag: "Dispatched", short: dispatched.right.short }
}

const waitOne = async ({
  client,
  short,
  wait,
}: {
  readonly client: AnyClient
  readonly short: string
  readonly wait: WaitParams
}): Promise<{ readonly code: ExitCode; readonly outcome: WaitOutcomeBody | undefined }> => {
  const res: Response = await client.sessions[":id"].wait.$post({
    param: { id: short },
    json: buildWaitRequestBody(wait),
  })
  const body = await readJson(res)
  const notOk = checkOk({ res, body, label: `spawn: wait for ${short}` })
  if (notOk !== undefined) return { code: notOk, outcome: undefined }
  const parsed = parseWaitOutcomeBody(body)
  if (Either.isLeft(parsed)) {
    console.error(`spawn: wait for ${short}: ${parsed.left.message}`)
    return { code: exitCodeForOutcome({ _tag: "HttpError" }), outcome: undefined }
  }
  return { code: exitCodeForWaitBody(parsed.right), outcome: parsed.right }
}

// One spawn attempt: POST /dispatch, then an optional pinned wait on the
// short it returns.
const spawnOne = async ({
  client,
  command,
}: {
  readonly client: AnyClient
  readonly command: Extract<Command, { readonly _tag: "Spawn" }>
}): Promise<{ readonly code: ExitCode; readonly line: string; readonly json: unknown }> => {
  const dispatched = await dispatchOne({ client, command })
  if (dispatched._tag === "Failed")
    return { code: dispatched.code, line: "", json: dispatched.body }
  const { short } = dispatched
  if (command.wait === undefined) {
    return {
      code: 0,
      line: formatSpawned({ short, intent: command.intent, wait: undefined }),
      json: { short },
    }
  }
  const waited = await waitOne({ client, short, wait: command.wait })
  return {
    code: waited.code,
    line: formatSpawned({ short, intent: command.intent, wait: waited.outcome }),
    json: { short, wait: waited.outcome },
  }
}

const printSpawnResults = ({
  attempts,
  json,
}: {
  readonly attempts: ReadonlyArray<{ readonly line: string; readonly json: unknown }>
  readonly json: boolean
}): void => {
  if (json) {
    console.log(JSON.stringify(attempts.map((a) => a.json)))
    return
  }
  for (const line of attempts.map((a) => a.line).filter((line) => line.length > 0))
    console.log(line)
}

const runSpawn = async ({
  client,
  command,
}: {
  readonly client: AnyClient
  readonly command: Extract<Command, { readonly _tag: "Spawn" }>
}): Promise<ExitCode> => {
  const attempts: Array<{
    readonly code: ExitCode
    readonly line: string
    readonly json: unknown
  }> = []
  for (let i = 0; i < command.n; i++) attempts.push(await spawnOne({ client, command }))
  printSpawnResults({ attempts, json: command.json })
  return worstExitCode(attempts.map((a) => a.code))
}

type NonHelpCommand = Exclude<Command, HelpCommand>

type AnyCommandHandler = (args: {
  readonly client: AnyClient
  // biome-ignore lint/suspicious/noExplicitAny: dispatch table intentionally erases each handler's narrowed command type — see AnyClient above
  readonly command: any
}) => Promise<ExitCode>

// A lookup table, not a switch, so this file's own command-dispatch step
// never grows a branch per subcommand as the surface grows (see
// SUBCOMMAND_PARSERS in agent.core.ts for the same pattern on the parse side).
const HANDLERS: Readonly<Record<NonHelpCommand["_tag"], AnyCommandHandler>> = {
  Sessions: runSessions,
  Explain: runExplain,
  Wait: runWait,
  Send: runSend,
  Keys: runKeys,
  Spawn: runSpawn,
  Stop: (args) => runOkShortCommand({ ...args, path: "stop", format: formatStopped }),
  Rm: (args) => runOkShortCommand({ ...args, path: "rm", format: formatRemoved }),
}

const runCommand = ({
  client,
  command,
}: {
  readonly client: AnyClient
  readonly command: NonHelpCommand
}): Promise<ExitCode> => HANDLERS[command._tag]({ client, command })

const main = async (): Promise<void> => {
  const parsed = parseAgentArgv(process.argv.slice(2))
  if (Either.isLeft(parsed)) {
    console.error(parsed.left.message)
    console.error(HELP)
    process.exit(exitCodeForUsage())
  }
  const command = parsed.right
  if (command._tag === "Help") {
    console.error(HELP)
    process.exit(0)
  }
  const url = resolveBaseUrl({ flag: command.url, env: process.env.PID_URL })
  const bareOk = await probeBare(url)
  const apiBase = resolveApiBase({ url, bareOk })
  const client: AnyClient = hc<AppType>(apiBase)
  const exitCode = await runCommand({ client, command })
  process.exit(exitCode)
}

try {
  await main()
} catch (err) {
  console.error(`pid: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
}
