#!/usr/bin/env bun
// pid — an agent-facing CLI over the pi-browser-dashboard daemon's session
// control surface (see AGENTS.md "Single-package CLI distribution"). This is
// the thin imperative shell: read argv/env/clock, probe the daemon, drive the
// typed `hc` client, print, and exit with the code agent.core.ts decided.
// Every decision (parsing, exit codes, formatting, response parsing) lives in
// agent.core.ts — this file only wires I/O to it.
import { basename } from "node:path"
import type { AppType } from "@pid/daemon/types"
import { Either } from "effect"
import { hc } from "hono/client"
import {
  buildDispatchRequestBody,
  buildFleetRunRequestBody,
  buildKeysRequestBody,
  buildPaneCloseBody,
  buildPaneNewBody,
  buildSendRequestBody,
  buildWaitRequestBody,
  type Command,
  type ExitCode,
  errorMessageFrom,
  exitCodeForFleetRunStatus,
  exitCodeForFleets,
  exitCodeForOutcome,
  exitCodeForPaneStatus,
  exitCodeForRulesErrors,
  exitCodeForTerminalLookup,
  exitCodeForUsage,
  exitCodeForWaitBody,
  exitCodeForWaitPostStatus,
  type FleetRunStarted,
  type FleetRunSummaryWire,
  filterByState,
  filterTerminalsByKey,
  formatExplain,
  formatFleetDryRun,
  formatFleetRunStarted,
  formatFleetRunSummary,
  formatFleetRuns,
  formatFleets,
  formatKeysSent,
  formatPaneClosed,
  formatPaneCreated,
  formatRemoved,
  formatRulesPreview,
  formatRulesStatus,
  formatSent,
  formatSessions,
  formatSpawned,
  formatStopped,
  formatTerminalStates,
  formatWaitOutcome,
  type HelpCommand,
  NAMED_KEYS_HELP,
  OUTPUT_ANCHORS_HELP,
  type PaneResponse,
  type ParseError,
  parseAgentArgv,
  parseDispatchResponse,
  parseExplainResponse,
  parseFleetDryRunResponse,
  parseFleetRunStarted,
  parseFleetRunSummary,
  parseFleetRunsResponse,
  parseFleetsResponse,
  parseKeysResponse,
  parseOkShortResponse,
  parsePaneResponse,
  parseRulesPreviewResponse,
  parseRulesStatusResponse,
  parseSendResponse,
  parseSessionsResponse,
  parseTerminalStatesResponse,
  parseWaitOutcomeBody,
  resolveApiBase,
  resolveBaseUrl,
  type SessionListEntry,
  type SessionRow,
  type TerminalRow,
  type TerminalStateEntry,
  WAIT_VIA_HELP,
  type WaitOutcomeBody,
  type WaitParams,
  worstExitCode,
} from "./agent.core"

const HELP = `pid — agent-facing CLI over the pi-browser-dashboard daemon

Usage:
  pid sessions [--state <slug,...>] [--json]
  pid explain <short> [--json]
  pid terminals [<scope>:<id>] [--json]
  pid pane new <scope>:<id> [--cwd <path>] [--json] [-- <command>...]
  pid pane close <scope>:<id> <paneId> [--json]
  pid wait <short> [--until <slug,...>] [--until-output <text> [--anchor <where>]]
           [--via supervisor|screen|either] [--timeout <ms>] [--json]
  pid send <short> <text...> [--wait <slug,...>] [--timeout <ms>] [--json]
  pid keys <short> <name...> [--wait <slug,...>] [--timeout <ms>] [--json]
  pid spawn <intent> [--n <count>] [--agent <name>] [--cwd <path>] [--wait <slug,...>] [--json]
  pid stop <short>
  pid rm <short>
  pid fleets [--project <id>] [--json]
  pid fleet run <name> [--project <id>] [--dry-run] [--wait] [--json]
  pid fleet runs [--project <id>] [--json]
  pid rules [--json]
  pid rules preview [--json]
  pid [--help] [--url <base>]

--json is accepted on every command (a superset of the table above) and
prints the daemon's own response verbatim; without it, output is formatted
for a human. --url and --help/-h are recognised anywhere in the invocation.
PID_URL overrides the default http://localhost:8787; --url overrides PID_URL.

session states: done, working, blocked, needs_input, idle, failed, stopped, unknown
terminal states: working, blocked, idle, unknown
key names: ${NAMED_KEYS_HELP}
wait via: ${WAIT_VIA_HELP}
anchors: ${OUTPUT_ANCHORS_HELP}

pid wait takes either condition, or both — first to fire wins. --until watches
a session's state; --until-output watches its screen for a literal substring
(no regex; capped at 200 characters), anchored anywhere on a line by default.
--via chooses which reading may settle an --until wait: supervisor (default)
trusts state.json only, screen trusts the classified pane only, either takes
whichever comes first. A satisfied wait prints which one settled it, because
"the pane looks done" is a weaker claim than "the agent reported done". Only
working, blocked and idle have screen evidence at all, so a screen-only wait on
done/failed/stopped/needs_input can never be satisfied. --until-output needs
the daemon's screen poller: with PID_TERMINAL_POLL_MS=0 it exits 8 at once
rather than waiting for a timeout that would read like "not yet".

A screen wait will not settle itself from a stale reading: if the daemon has not
read that pane in the last 60s it keeps waiting rather than answering off an old
record, so a timeout here means "nothing current said so", not "it never will".
When one times out against a session you expected it to settle on, pid explain
shows how old the pane's reading actually is.

pid terminals reports what the daemon last read off each terminal's screen —
working, blocked, idle or unknown — including sessions nobody has opened in
the dashboard. That is a different question from a session's roster state
(pid sessions / pid explain): the evidence is the pane itself, so it also
covers a claude or pi a human started by hand. With no argument it prints
every terminal; with a <scope>:<id> key (session:ab12, project:my-app,
global:global, orchestrator:orchestrator) it prints just that one, and exits 6
if that terminal has no classification yet. Each row carries two ages, because
a reading has two: "for 2h" is how long that terminal has looked like this, and
"read 7s" is how long ago the daemon last read the pane. A row reading
"idle  for 2h  read 7s" is current evidence about a pane that has been resting
all morning — not a two-hour-old guess.

pid pane new opens a pane in a terminal this daemon derived and owns, and
pid pane close closes one it opened itself. The target is the same
<scope>:<id> key pid terminals prints — never a zellij session name, which
the daemon looks up itself so a session it does not own cannot be named at
all. Everything after -- is the pane's command as argv (no shell, so no
quoting to get wrong), and --cwd must exist: zellij would accept a missing
directory and run the command elsewhere, so the daemon refuses instead.
The new pane's own screen shows up in pid terminals under
<scope>:<id>#<paneId>, which pane new prints for you.

Refusals are exit 2 and each names itself: not_created_here (a pane this
daemon did not open, including every pane it opened before its last restart —
the bookkeeping is in memory, and refusing beats guessing), own_pane (the pane
you are calling from), last_pane (the session's only pane, whose closure would
leave the session with none), pane_budget (as many panes as the screen poller
classifies — a further one could not be observed), cwd_missing. A terminal
this daemon has no record of at all is exit 6. This surface never kills or
deletes a session.

pid fleets lists the declarative multi-agent recipes in a project's
.pid/fleet.json (schema + validation + wave planning only). pid fleet run
executes one by name, wave by wave — --dry-run reports what would be spawned
without spawning anything (the easy, safe way to check a recipe before
committing real quota to it); without it, spawning starts in the background
and the command returns immediately unless --wait is given, in which case it
polls until the run finishes and exits non-zero if any step failed or was
skipped. pid fleet runs lists every run started for a project. --project
defaults to the current directory's basename, which only works when this CLI
runs on the same machine as the daemon.

pid rules lists the state-change automation rules in
<claudeConfigDir>/pid-dashboard/rules.json — off by default (both a missing
file and enabled: false, or absent, mean nothing fires), plus any validation
errors, whether the engine is paused, and recent firing activity. Each rule
prints as "name  source  <trigger>", where source is which reading fires it
(supervisor or screen) and the trigger is the state or screen slug, the matcher
if the rule names one, and the dwell if it has one. pid rules preview
evaluates every currently-known session against those rules and reports what
would happen — it fires nothing.

Full agent guide (this CLI, the HTTP endpoints, wait/explain/spawn recipes):
  <base>/agent-skill.md

Exit codes:
  0  success / wait satisfied
  1  transport failure, 5xx, unreachable daemon, or an unparseable response
  2  usage error, or an invalid recipe/rules file / cap-exceeded fleet run
     request
  3  wait timed out
  4  occupant_changed — the session was replaced under the wait
  5  removed — the session went away
  6  not found
  7  "pid fleet run --wait": the run finished with a failed or skipped step,
     or refused to start because that fleet already has an active run
  8  screen_polling_disabled — "--until-output" needs the daemon's screen
     poller, which is off (PID_TERMINAL_POLL_MS=0). Not a timeout: retrying
     cannot help until the daemon is reconfigured
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
    json: buildWaitRequestBody({
      until: command.until,
      untilOutput: command.untilOutput,
      via: command.via,
      timeoutMs: command.timeoutMs,
    }),
  })
  const body = await readJson(res)
  // `checkOk`'s generic 404-or-else split cannot see the one status this route
  // has that no other does: 409 `screen_polling_disabled` (an `--until-output`
  // wait against a daemon whose poller is off). It gets its own exit code so an
  // agent never mistakes a misconfigured daemon for "the pattern has not
  // appeared yet" and retries forever.
  if (!res.ok) {
    console.error(`wait: ${errorMessageFrom(body)}`)
    return exitCodeForWaitPostStatus(res.status)
  }
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

// `--project` defaults to the current directory's basename — a project id IS
// its directory name under the daemon's configured projectsRoot (see
// apps/daemon/src/features/projects/projects.io.ts), so this only resolves
// correctly when `pid` runs on the same machine as the daemon (true for the
// `pid-dashboard` single-port distribution and the common localhost case;
// pass `--project` explicitly otherwise).
const runFleets = async ({
  client,
  command,
}: {
  readonly client: AnyClient
  readonly command: Extract<Command, { readonly _tag: "Fleets" }>
}): Promise<ExitCode> => {
  const project = command.project ?? basename(process.cwd())
  const res: Response = await client.projects[":id"].fleets.$get({ param: { id: project } })
  const body = await readJson(res)
  const notOk = checkOk({ res, body, label: "fleets" })
  if (notOk !== undefined) return notOk
  return printAndExit({
    body,
    json: command.json,
    parsed: parseFleetsResponse(body),
    label: "fleets",
    format: formatFleets,
    exitCodeFor: exitCodeForFleets,
  })
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const FLEET_RUN_POLL_MS = 1000

// POST .../fleets/:name/run responds 400/409 for conditions `checkOk`'s
// generic 404-or-HttpError split does not distinguish: an invalid recipe or a
// cap violation (400) is a usage-shaped problem (exit 2, matching "pid
// fleets"'s own invalid-recipe code), and an already-active twin run (409) is
// the fleet-run family's own rolled-up "did not run cleanly" outcome (7) —
// see agent.core.ts's ExitCode comment for why 7 exists at all.
const exitCodeForFleetRunPostStatus = (status: number): ExitCode => {
  if (status === 404) return 6
  if (status === 409) return 7
  if (status === 400) return 2
  return 1
}

// One GET .../fleet-runs/:runId poll: resolves the exit code once the daemon
// or the parser has spoken, or `summary` when the caller still needs to
// decide (its own status is "running", or a fresh fetch is due).
const pollFleetRunOnce = async ({
  client,
  project,
  runId,
}: {
  readonly client: AnyClient
  readonly project: string
  readonly runId: string
}): Promise<{
  readonly code: ExitCode
  readonly body: unknown
  readonly summary: FleetRunSummaryWire | undefined
}> => {
  const res: Response = await client.projects[":id"]["fleet-runs"][":runId"].$get({
    param: { id: project, runId },
  })
  const body = await readJson(res)
  const notOk = checkOk({ res, body, label: "fleet run" })
  if (notOk !== undefined) return { code: notOk, body, summary: undefined }
  const parsed = parseFleetRunSummary(body)
  if (Either.isLeft(parsed)) {
    console.error(`fleet run: ${parsed.left.message}`)
    return { code: exitCodeForOutcome({ _tag: "HttpError" }), body, summary: undefined }
  }
  return { code: 0, body, summary: parsed.right }
}

const printFleetRunResult = ({
  json,
  body,
  summary,
}: {
  readonly json: boolean
  readonly body: unknown
  readonly summary: FleetRunSummaryWire
}): void => {
  if (json) console.log(JSON.stringify(body))
  else console.log(formatFleetRunSummary(summary))
}

// `--wait`: poll until the run leaves "running", then print and resolve the
// exit code from its final status. No client-side timeout — the daemon's own
// per-step `timeoutMs` already bounds how long a run can stay "running".
const followFleetRun = async ({
  client,
  project,
  runId,
  json,
}: {
  readonly client: AnyClient
  readonly project: string
  readonly runId: string
  readonly json: boolean
}): Promise<ExitCode> => {
  while (true) {
    const polled = await pollFleetRunOnce({ client, project, runId })
    if (polled.summary === undefined) return polled.code
    if (polled.summary.status === "running") {
      await sleep(FLEET_RUN_POLL_MS)
      continue
    }
    printFleetRunResult({ json, body: polled.body, summary: polled.summary })
    return exitCodeForFleetRunStatus(polled.summary.status)
  }
}

const printFleetRunStarted = ({
  json,
  body,
  started,
}: {
  readonly json: boolean
  readonly body: unknown
  readonly started: FleetRunStarted
}): void => {
  if (json) console.log(JSON.stringify(body))
  else console.log(formatFleetRunStarted(started))
}

// Everything after a successful POST: dry run, a real run left to poll for
// itself, or a real run followed to completion via --wait. Split out of
// runFleetRun so that function's own branch count stays under fallow's
// cyclomatic ceiling.
const handleFleetRunResponse = async ({
  client,
  command,
  project,
  body,
}: {
  readonly client: AnyClient
  readonly command: Extract<Command, { readonly _tag: "FleetRun" }>
  readonly project: string
  readonly body: unknown
}): Promise<ExitCode> => {
  if (command.dryRun) {
    return printAndExit({
      body,
      json: command.json,
      parsed: parseFleetDryRunResponse(body),
      label: "fleet run",
      format: formatFleetDryRun,
      exitCodeFor: () => 0,
    })
  }
  const started = parseFleetRunStarted(body)
  if (Either.isLeft(started)) {
    console.error(`fleet run: ${started.left.message}`)
    return exitCodeForOutcome({ _tag: "HttpError" })
  }
  if (command.wait) {
    return followFleetRun({ client, project, runId: started.right.runId, json: command.json })
  }
  printFleetRunStarted({ json: command.json, body, started: started.right })
  return 0
}

const runFleetRun = async ({
  client,
  command,
}: {
  readonly client: AnyClient
  readonly command: Extract<Command, { readonly _tag: "FleetRun" }>
}): Promise<ExitCode> => {
  const project = command.project ?? basename(process.cwd())
  const res: Response = await client.projects[":id"].fleets[":name"].run.$post({
    param: { id: project, name: command.name },
    json: buildFleetRunRequestBody({ dryRun: command.dryRun }),
  })
  const body = await readJson(res)
  if (!res.ok) {
    console.error(`fleet run: ${errorMessageFrom(body)}`)
    return exitCodeForFleetRunPostStatus(res.status)
  }
  return handleFleetRunResponse({ client, command, project, body })
}

const runFleetRuns = async ({
  client,
  command,
}: {
  readonly client: AnyClient
  readonly command: Extract<Command, { readonly _tag: "FleetRuns" }>
}): Promise<ExitCode> => {
  const project = command.project ?? basename(process.cwd())
  const res: Response = await client.projects[":id"]["fleet-runs"].$get({ param: { id: project } })
  const body = await readJson(res)
  const notOk = checkOk({ res, body, label: "fleet runs" })
  if (notOk !== undefined) return notOk
  return printAndExit({
    body,
    json: command.json,
    parsed: parseFleetRunsResponse(body),
    label: "fleet runs",
    format: formatFleetRuns,
    exitCodeFor: () => 0,
  })
}

const runRules = async ({
  client,
  command,
}: {
  readonly client: AnyClient
  readonly command: Extract<Command, { readonly _tag: "Rules" }>
}): Promise<ExitCode> => {
  const res: Response = await client.rules.$get()
  const body = await readJson(res)
  const notOk = checkOk({ res, body, label: "rules" })
  if (notOk !== undefined) return notOk
  return printAndExit({
    body,
    json: command.json,
    parsed: parseRulesStatusResponse(body),
    label: "rules",
    format: formatRulesStatus,
    exitCodeFor: (v) => exitCodeForRulesErrors(v.errors),
  })
}

const runRulesPreview = async ({
  client,
  command,
}: {
  readonly client: AnyClient
  readonly command: Extract<Command, { readonly _tag: "RulesPreview" }>
}): Promise<ExitCode> => {
  const res: Response = await client.rules.preview.$post()
  const body = await readJson(res)
  const notOk = checkOk({ res, body, label: "rules preview" })
  if (notOk !== undefined) return notOk
  return printAndExit({
    body,
    json: command.json,
    parsed: parseRulesPreviewResponse(body),
    label: "rules preview",
    format: formatRulesPreview,
    exitCodeFor: (v) => exitCodeForRulesErrors(v.errors),
  })
}

const toTerminalRow = (e: TerminalStateEntry): TerminalRow => ({
  key: e.key,
  state: e.state,
  matcher: e.matcher,
  evidence: e.evidence,
  // Two stamps, two ages: parsed here (the shell) and never conflated in the
  // core, which prints them as "read <age>" and "for <age>".
  screenReadAtMs: e.screenReadAt === undefined ? undefined : Date.parse(e.screenReadAt),
  stateChangedAtMs: e.stateChangedAt === undefined ? undefined : Date.parse(e.stateChangedAt),
})

// GET /terminal/states answers with a map, so "verbatim" here means the raw
// map narrowed to the matched keys — never a re-serialized reconstruction of
// the fields this CLI happens to parse (the same rule printSessionsJson
// follows for the array `sessions` returns). The container stays a map even
// for a single key, so `pid terminals --json | jq` reads the same shape
// whether or not a key was passed.
const narrowTerminalsJson = ({
  body,
  matched,
}: {
  readonly body: unknown
  readonly matched: ReadonlyArray<TerminalStateEntry>
}): Record<string, unknown> => {
  const keep = new Set(matched.map((t) => t.key))
  const isMap = typeof body === "object" && body !== null && !Array.isArray(body)
  const entries = isMap ? Object.entries(body) : []
  return Object.fromEntries(entries.filter(([key]) => keep.has(key)))
}

const printTerminals = ({
  body,
  matched,
  json,
}: {
  readonly body: unknown
  readonly matched: ReadonlyArray<TerminalStateEntry>
  readonly json: boolean
}): void => {
  if (json) {
    console.log(JSON.stringify(narrowTerminalsJson({ body, matched })))
    return
  }
  console.log(formatTerminalStates({ terminals: matched.map(toTerminalRow), now: Date.now() }))
}

// A requested key that matched nothing is reported on stderr only, the same
// way `explain`'s 404 is: stdout stays empty rather than claiming "no terminal
// states" (the map is not empty — this key is missing from it). `--json` still
// prints, since an empty map is valid JSON and keeps a `jq` pipeline honest.
const reportTerminals = ({
  body,
  matched,
  command,
}: {
  readonly body: unknown
  readonly matched: ReadonlyArray<TerminalStateEntry>
  readonly command: Extract<Command, { readonly _tag: "Terminals" }>
}): ExitCode => {
  const code = exitCodeForTerminalLookup({ key: command.key, matched: matched.length })
  if (code === 0 || command.json) printTerminals({ body, matched, json: command.json })
  // The endpoint refreshes a stale poll pass fire-and-forget, so a
  // classification for a just-spawned session can land moments after this very
  // response — say so rather than letting an agent read 6 as "that short does
  // not exist".
  if (code !== 0) console.error(`terminals: ${command.key}: no classification yet — retry`)
  return code
}

const runTerminals = async ({
  client,
  command,
}: {
  readonly client: AnyClient
  readonly command: Extract<Command, { readonly _tag: "Terminals" }>
}): Promise<ExitCode> => {
  const res: Response = await client.terminal.states.$get()
  const body = await readJson(res)
  const notOk = checkOk({ res, body, label: "terminals" })
  if (notOk !== undefined) return notOk
  const parsed = parseTerminalStatesResponse(body)
  if (Either.isLeft(parsed)) {
    console.error(`terminals: ${parsed.left.message}`)
    return exitCodeForOutcome({ _tag: "HttpError" })
  }
  const matched = filterTerminalsByKey({ terminals: parsed.right, key: command.key })
  return reportTerminals({ body, matched, command })
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

// --- panes -------------------------------------------------------------------

// One response shape, two commands: a create reply carries the pane's name and
// the key its screen appears under, a close reply carries `closed`. Both are
// reported the same way — the daemon's own body under --json, one line otherwise.
// `--json` prints the daemon's own body verbatim, the same contract every other
// command follows; without it, one line built from the parsed reply. Exactly one
// of the two is printed, and a refusal prints the daemon's own message on stderr
// rather than a paraphrase.
// A refusal: the daemon named it and explained it, so print its own words —
// under --json the body too, since a refusal reason is exactly what a scripted
// caller wants to read.
const reportPaneRefusal = ({
  res,
  body,
  label,
  json,
}: {
  readonly res: Response
  readonly body: unknown
  readonly label: string
  readonly json: boolean
}): ExitCode => {
  if (json) console.log(JSON.stringify(body))
  console.error(`${label}: ${errorMessageFrom(body)}`)
  return exitCodeForPaneStatus(res.status)
}

const reportPane = ({
  res,
  body,
  label,
  json,
  format,
}: {
  readonly res: Response
  readonly body: unknown
  readonly label: string
  readonly json: boolean
  readonly format: (parsed: PaneResponse) => string
}): ExitCode => {
  if (!res.ok) return reportPaneRefusal({ res, body, label, json })
  if (json) {
    console.log(JSON.stringify(body))
    return 0
  }
  const parsed = parsePaneResponse(body)
  if (Either.isLeft(parsed)) {
    console.error(`${label}: ${parsed.left.message}`)
    return 1
  }
  console.log(format(parsed.right))
  return 0
}

// Split for the human line only — the request body's own split happens in the
// pure core (buildPaneNewBody).
const paneTargetOf = (key: string): { readonly scope: string; readonly id: string } => {
  const idx = key.indexOf(":")
  return { scope: key.slice(0, idx), id: key.slice(idx + 1) }
}

const runPaneNew = async ({
  client,
  command,
}: {
  readonly client: AnyClient
  readonly command: Extract<Command, { readonly _tag: "PaneNew" }>
}): Promise<ExitCode> => {
  const res: Response = await client.terminal.panes.$post({
    json: buildPaneNewBody({ key: command.key, cwd: command.cwd, command: command.command }),
  })
  const body = await readJson(res)
  return reportPane({
    res,
    body,
    label: "pane new",
    json: command.json,
    format: (parsed) =>
      formatPaneCreated({
        ...paneTargetOf(command.key),
        paneId: parsed.paneId,
        paneName: parsed.paneName,
        sessionName: parsed.sessionName,
        key: parsed.key,
      }),
  })
}

const runPaneClose = async ({
  client,
  command,
}: {
  readonly client: AnyClient
  readonly command: Extract<Command, { readonly _tag: "PaneClose" }>
}): Promise<ExitCode> => {
  const res: Response = await client.terminal.panes.close.$post({
    json: buildPaneCloseBody({
      key: command.key,
      paneId: command.paneId,
      // Where this CLI is running, straight from zellij's own environment, so the
      // daemon can refuse to close the pane the caller is sitting in. Untrusted
      // by construction: it can only ever make the daemon say no.
      callerPaneId: process.env.ZELLIJ_PANE_ID,
      callerSessionName: process.env.ZELLIJ_SESSION_NAME,
    }),
  })
  const body = await readJson(res)
  return reportPane({
    res,
    body,
    label: "pane close",
    json: command.json,
    format: (parsed) => formatPaneClosed({ paneId: parsed.paneId, closed: parsed.closed }),
  })
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
  Fleets: runFleets,
  FleetRun: runFleetRun,
  FleetRuns: runFleetRuns,
  Rules: runRules,
  RulesPreview: runRulesPreview,
  Terminals: runTerminals,
  PaneNew: runPaneNew,
  PaneClose: runPaneClose,
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
