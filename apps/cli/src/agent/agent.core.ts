// Pure argv parsing, request-body building, response parsing, exit-code
// mapping and output formatting for `pid` — the agent-facing CLI over the
// daemon's session-control surface. No I/O — agent/main.ts (the imperative
// shell) reads argv/env/clock, drives the `hc` client, and calls back into
// this module with plain data.
//
// Why an agent needs this at all: an orchestrating agent composes `pid` in a
// shell (`pid wait ab12 --until done && pid send cd34 "next step"`), so the
// process exit code IS the API. Every exit-code decision below is therefore a
// small total function with exhaustive tests, not a `process.exit` scattered
// through the shell.
//
// Every function here is kept deliberately small (one decision at a time,
// `Either.all` to combine independent checks into a single branch) so
// `bun run audit`'s complexity ceiling never sees a long if/else chain — the
// same discipline apps/daemon/src/features/sessions/sessions-*.core.ts uses.

import { Either } from "effect"

// --- Session state slugs ----------------------------------------------------
//
// Mirrors `KNOWN_STATES` in apps/daemon/src/features/sessions/sessions.core.ts.
// `@pid/daemon`'s package.json `exports` map only publishes ".", "./server"
// and "./types" (the Hono `AppType` for the `hc` client) — a deep import of a
// slice-internal module like `sessions.core` does not resolve from apps/cli
// (verified with `tsc --noEmit`: "Cannot find module
// '@pid/daemon/features/sessions/sessions.core'"). Keeping a literal copy here
// is the documented fallback the task calls for.
const SESSION_STATE_SLUGS = [
  "done",
  "working",
  "blocked",
  "needs_input",
  "idle",
  "failed",
  "stopped",
  "unknown",
] as const
export type SessionStateSlug = (typeof SESSION_STATE_SLUGS)[number]

export const isSessionStateSlug = (s: string): s is SessionStateSlug =>
  (SESSION_STATE_SLUGS as readonly string[]).includes(s)

// --- Named key vocabulary ----------------------------------------------------
//
// Mirrors `NamedKey` in apps/daemon/src/features/sessions/sessions-keys.core.ts
// — same deep-import limitation as above.
const NAMED_KEYS = [
  "escape",
  "enter",
  "tab",
  "shift-tab",
  "up",
  "down",
  "left",
  "right",
  "home",
  "end",
  "page-up",
  "page-down",
  "backspace",
  "delete",
  "space",
] as const
export type NamedKeyName = (typeof NAMED_KEYS)[number]

export const isNamedKeyName = (s: string): s is NamedKeyName =>
  (NAMED_KEYS as readonly string[]).includes(s)

export const NAMED_KEYS_HELP = NAMED_KEYS.join(", ")

// --- Command model -----------------------------------------------------------

export type WaitParams = {
  readonly until: ReadonlyArray<SessionStateSlug>
  readonly timeoutMs: number | undefined
}

export type SessionsCommand = {
  readonly _tag: "Sessions"
  readonly state: ReadonlyArray<SessionStateSlug> | undefined
  readonly json: boolean
  readonly url: string | undefined
}

export type ExplainCommand = {
  readonly _tag: "Explain"
  readonly short: string
  readonly json: boolean
  readonly url: string | undefined
}

export type WaitCommand = {
  readonly _tag: "Wait"
  readonly short: string
  readonly until: ReadonlyArray<SessionStateSlug>
  readonly timeoutMs: number | undefined
  readonly json: boolean
  readonly url: string | undefined
}

export type SendCommand = {
  readonly _tag: "Send"
  readonly short: string
  readonly text: string
  readonly wait: WaitParams | undefined
  readonly json: boolean
  readonly url: string | undefined
}

export type KeysCommand = {
  readonly _tag: "Keys"
  readonly short: string
  readonly names: ReadonlyArray<NamedKeyName>
  readonly wait: WaitParams | undefined
  readonly json: boolean
  readonly url: string | undefined
}

export type SpawnCommand = {
  readonly _tag: "Spawn"
  readonly intent: string
  readonly n: number
  readonly agent: string | undefined
  readonly cwd: string | undefined
  readonly wait: WaitParams | undefined
  readonly json: boolean
  readonly url: string | undefined
}

export type StopCommand = {
  readonly _tag: "Stop"
  readonly short: string
  readonly json: boolean
  readonly url: string | undefined
}

export type RmCommand = {
  readonly _tag: "Rm"
  readonly short: string
  readonly json: boolean
  readonly url: string | undefined
}

export type FleetsCommand = {
  readonly _tag: "Fleets"
  // undefined means "use the current directory's basename" — resolved by the
  // shell (main.ts), which is the sanctioned place to read cwd; this core
  // stays synchronous data-in/data-out.
  readonly project: string | undefined
  readonly json: boolean
  readonly url: string | undefined
}

export type FleetRunCommand = {
  readonly _tag: "FleetRun"
  readonly name: string
  readonly project: string | undefined
  readonly dryRun: boolean
  readonly wait: boolean
  readonly json: boolean
  readonly url: string | undefined
}

export type FleetRunsCommand = {
  readonly _tag: "FleetRuns"
  readonly project: string | undefined
  readonly json: boolean
  readonly url: string | undefined
}

export type HelpCommand = {
  readonly _tag: "Help"
  readonly url: string | undefined
}

export type Command =
  | SessionsCommand
  | ExplainCommand
  | WaitCommand
  | SendCommand
  | KeysCommand
  | SpawnCommand
  | StopCommand
  | RmCommand
  | FleetsCommand
  | FleetRunCommand
  | FleetRunsCommand
  | HelpCommand

export type UsageError = {
  readonly _tag: "UsageError"
  readonly message: string
}

const usageError = (message: string): UsageError => ({ _tag: "UsageError", message })

// --- Argv scanning ------------------------------------------------------------
//
// A minimal, general-purpose flag/positional splitter shared by every
// subcommand parser below. Each subcommand declares which flags it accepts
// (valued or boolean) and gets back the leftover positionals plus a
// name->value map; an unrecognised flag or a valued flag missing its value is
// a UsageError, never a silent no-op.

type FlagSpec = { readonly name: string; readonly boolean: boolean }

type ScanResult = {
  readonly positionals: ReadonlyArray<string>
  readonly flags: ReadonlyMap<string, string>
}

// One argv token, classified before any flag-spec lookup happens — kept
// separate from `resolveFlag` below so neither function juggles more than one
// kind of decision.
type FlagToken = { readonly name: string; readonly inlineValue: string | undefined }

const classifyToken = (
  tok: string,
): { readonly positional: string } | { readonly flag: FlagToken } => {
  if (!tok.startsWith("--")) return { positional: tok }
  const eq = tok.indexOf("=")
  return eq === -1
    ? { flag: { name: tok.slice(2), inlineValue: undefined } }
    : { flag: { name: tok.slice(2, eq), inlineValue: tok.slice(eq + 1) } }
}

// A resolved flag either sets a value and says how many argv slots it
// consumed (1 for `--flag=x` / a boolean flag, 2 for `--flag x`), or fails.
type FlagResolution =
  | { readonly _tag: "Set"; readonly value: string; readonly advance: 1 | 2 }
  | { readonly _tag: "Error"; readonly message: string }

const resolveBooleanFlag = ({
  command,
  token,
}: {
  readonly command: string
  readonly token: FlagToken
}): FlagResolution =>
  token.inlineValue === undefined
    ? { _tag: "Set", value: "true", advance: 1 }
    : { _tag: "Error", message: `${command}: --${token.name} does not take a value` }

const resolveValuedFlag = ({
  command,
  token,
  nextToken,
}: {
  readonly command: string
  readonly token: FlagToken
  readonly nextToken: string | undefined
}): FlagResolution => {
  if (token.inlineValue !== undefined) return { _tag: "Set", value: token.inlineValue, advance: 1 }
  if (nextToken === undefined || nextToken.startsWith("--")) {
    return { _tag: "Error", message: `${command}: --${token.name} requires a value` }
  }
  return { _tag: "Set", value: nextToken, advance: 2 }
}

const resolveFlag = ({
  command,
  token,
  spec,
  nextToken,
}: {
  readonly command: string
  readonly token: FlagToken
  readonly spec: FlagSpec | undefined
  readonly nextToken: string | undefined
}): FlagResolution => {
  if (!spec) return { _tag: "Error", message: `${command}: unknown flag --${token.name}` }
  return spec.boolean
    ? resolveBooleanFlag({ command, token })
    : resolveValuedFlag({ command, token, nextToken })
}

// The three things one scan step can produce: a positional, a resolved flag
// (with how many argv slots it consumed), or an error. `index` is always
// `< argv.length` (the only caller, scanArgv's loop, guarantees it), so the
// "index out of range" arm below is unreachable in practice — it exists only
// because `noUncheckedIndexedAccess` types `argv[index]` as possibly
// `undefined` regardless.
type ScanStep =
  | { readonly _tag: "Positional"; readonly value: string }
  | {
      readonly _tag: "Flag"
      readonly name: string
      readonly value: string
      readonly advance: 1 | 2
    }
  | { readonly _tag: "Error"; readonly message: string }

const scanStep = ({
  command,
  argv,
  index,
  specByName,
}: {
  readonly command: string
  readonly argv: ReadonlyArray<string>
  readonly index: number
  readonly specByName: ReadonlyMap<string, FlagSpec>
}): ScanStep => {
  const tok = argv[index]
  if (tok === undefined) return { _tag: "Error", message: `${command}: internal argv scan error` }
  const classified = classifyToken(tok)
  if ("positional" in classified) return { _tag: "Positional", value: classified.positional }
  const resolution = resolveFlag({
    command,
    token: classified.flag,
    spec: specByName.get(classified.flag.name),
    nextToken: argv[index + 1],
  })
  return resolution._tag === "Error"
    ? { _tag: "Error", message: resolution.message }
    : {
        _tag: "Flag",
        name: classified.flag.name,
        value: resolution.value,
        advance: resolution.advance,
      }
}

const scanArgv = ({
  command,
  argv,
  flagSpecs,
}: {
  readonly command: string
  readonly argv: ReadonlyArray<string>
  readonly flagSpecs: ReadonlyArray<FlagSpec>
}): Either.Either<ScanResult, UsageError> => {
  const specByName = new Map(flagSpecs.map((f): readonly [string, FlagSpec] => [f.name, f]))
  const positionals: string[] = []
  const flags = new Map<string, string>()
  let i = 0
  while (i < argv.length) {
    const step = scanStep({ command, argv, index: i, specByName })
    if (step._tag === "Error") return Either.left(usageError(step.message))
    if (step._tag === "Positional") {
      positionals.push(step.value)
      i += 1
      continue
    }
    flags.set(step.name, step.value)
    i += step.advance
  }
  return Either.right({ positionals, flags })
}

const FLAG_JSON: FlagSpec = { name: "json", boolean: true }
const FLAG_STATE: FlagSpec = { name: "state", boolean: false }
const FLAG_UNTIL: FlagSpec = { name: "until", boolean: false }
const FLAG_TIMEOUT: FlagSpec = { name: "timeout", boolean: false }
const FLAG_WAIT: FlagSpec = { name: "wait", boolean: false }
const FLAG_N: FlagSpec = { name: "n", boolean: false }
const FLAG_AGENT: FlagSpec = { name: "agent", boolean: false }
const FLAG_CWD: FlagSpec = { name: "cwd", boolean: false }
const FLAG_PROJECT: FlagSpec = { name: "project", boolean: false }
const FLAG_DRY_RUN: FlagSpec = { name: "dry-run", boolean: true }
// A boolean --wait for `fleet run` ("follow to completion") — distinct from
// FLAG_WAIT above (send/keys/spawn's valued `--wait <slug,...>`). Each
// subcommand's scanArgv call builds its own specByName map from its own
// flagSpecs list, so the shared flag NAME "wait" meaning different things to
// different subcommands is not a collision.
const FLAG_FLEET_WAIT: FlagSpec = { name: "wait", boolean: true }

const parseOneSlug = ({
  command,
  flag,
  item,
}: {
  readonly command: string
  readonly flag: string
  readonly item: string
}): Either.Either<SessionStateSlug, UsageError> =>
  isSessionStateSlug(item)
    ? Either.right(item)
    : Either.left(usageError(`${command}: --${flag} contains an unknown state: "${item}"`))

const parseStateSlugList = ({
  command,
  flag,
  raw,
}: {
  readonly command: string
  readonly flag: string
  readonly raw: string
}): Either.Either<ReadonlyArray<SessionStateSlug>, UsageError> => {
  const items = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
  const parsed = Either.all(items.map((item) => parseOneSlug({ command, flag, item })))
  if (Either.isLeft(parsed)) return Either.left(parsed.left)
  const slugs = [...new Set(parsed.right)]
  if (slugs.length === 0) {
    return Either.left(usageError(`${command}: --${flag} must list at least one session state`))
  }
  return Either.right(slugs)
}

const parsePositiveInt = ({
  command,
  flag,
  raw,
}: {
  readonly command: string
  readonly flag: string
  readonly raw: string
}): Either.Either<number, UsageError> => {
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 1) {
    return Either.left(usageError(`${command}: --${flag} must be a positive integer, got "${raw}"`))
  }
  return Either.right(n)
}

// Every subcommand accepts --json uniformly (a deliberate superset of the
// documented per-command table — see AGENTS.md), so it is folded in here
// rather than repeated at each call site.
const withJson = (flagSpecs: ReadonlyArray<FlagSpec>): ReadonlyArray<FlagSpec> => [
  ...flagSpecs,
  FLAG_JSON,
]

// Shared by explain/wait/stop/rm: exactly one positional <short>, nothing more.
const requireSingleShort = ({
  command,
  positionals,
}: {
  readonly command: string
  readonly positionals: ReadonlyArray<string>
}): Either.Either<string, UsageError> => {
  const short = positionals[0]
  if (short === undefined) return Either.left(usageError(`${command}: requires a <short> argument`))
  const extra = rejectExtraPositionals({ command, positionals, max: 1 })
  return Either.isLeft(extra) ? Either.left(extra.left) : Either.right(short)
}

// Shared by send/keys: a <short> plus one or more trailing positionals
// (`<text...>` / `<name...>`), which the caller interprets its own way.
const requireShortAndRest = ({
  command,
  positionals,
  restLabel,
}: {
  readonly command: string
  readonly positionals: ReadonlyArray<string>
  readonly restLabel: string
}): Either.Either<{ readonly short: string; readonly rest: ReadonlyArray<string> }, UsageError> => {
  const short = positionals[0]
  if (short === undefined || positionals.length < 2) {
    return Either.left(usageError(`${command}: requires <short> and ${restLabel}`))
  }
  return Either.right({ short, rest: positionals.slice(1) })
}

// Shared "no more than `max` positionals" check — `sessions` uses max 0,
// explain/wait/stop/rm (via requireSingleShort above) use max 1.
const rejectExtraPositionals = ({
  command,
  positionals,
  max,
}: {
  readonly command: string
  readonly positionals: ReadonlyArray<string>
  readonly max: number
}): Either.Either<void, UsageError> => {
  if (positionals.length <= max) return Either.right(undefined)
  const extra = positionals.slice(max)
  return Either.left(
    usageError(`${command}: unexpected argument${extra.length > 1 ? "s" : ""}: ${extra.join(" ")}`),
  )
}

const parseOptionalStateFlag = ({
  command,
  flag,
  flags,
}: {
  readonly command: string
  readonly flag: string
  readonly flags: ReadonlyMap<string, string>
}): Either.Either<ReadonlyArray<SessionStateSlug> | undefined, UsageError> => {
  const raw = flags.get(flag)
  return raw === undefined ? Either.right(undefined) : parseStateSlugList({ command, flag, raw })
}

const parseOptionalTimeout = ({
  command,
  flags,
}: {
  readonly command: string
  readonly flags: ReadonlyMap<string, string>
}): Either.Either<number | undefined, UsageError> => {
  const raw = flags.get("timeout")
  return raw === undefined
    ? Either.right(undefined)
    : parsePositiveInt({ command, flag: "timeout", raw })
}

const parseSessionsCommand = (
  rest: ReadonlyArray<string>,
  url: string | undefined,
): Either.Either<Command, UsageError> => {
  const scanned = scanArgv({ command: "sessions", argv: rest, flagSpecs: withJson([FLAG_STATE]) })
  if (Either.isLeft(scanned)) return Either.left(scanned.left)
  const { positionals, flags } = scanned.right
  const extra = rejectExtraPositionals({ command: "sessions", positionals, max: 0 })
  if (Either.isLeft(extra)) return Either.left(extra.left)
  const state = parseOptionalStateFlag({ command: "sessions", flag: "state", flags })
  if (Either.isLeft(state)) return Either.left(state.left)
  return Either.right({ _tag: "Sessions", state: state.right, json: flags.has("json"), url })
}

const parseExplainCommand = (
  rest: ReadonlyArray<string>,
  url: string | undefined,
): Either.Either<Command, UsageError> => {
  const scanned = scanArgv({ command: "explain", argv: rest, flagSpecs: withJson([]) })
  if (Either.isLeft(scanned)) return Either.left(scanned.left)
  const short = requireSingleShort({ command: "explain", positionals: scanned.right.positionals })
  if (Either.isLeft(short)) return Either.left(short.left)
  return Either.right({
    _tag: "Explain",
    short: short.right,
    json: scanned.right.flags.has("json"),
    url,
  })
}

const parseWaitCommand = (
  rest: ReadonlyArray<string>,
  url: string | undefined,
): Either.Either<Command, UsageError> => {
  const scanned = scanArgv({
    command: "wait",
    argv: rest,
    flagSpecs: withJson([FLAG_UNTIL, FLAG_TIMEOUT]),
  })
  if (Either.isLeft(scanned)) return Either.left(scanned.left)
  const { positionals, flags } = scanned.right
  const untilRaw = flags.get("until")
  if (untilRaw === undefined) return Either.left(usageError("wait: --until is required"))
  const combined = Either.all({
    short: requireSingleShort({ command: "wait", positionals }),
    until: parseStateSlugList({ command: "wait", flag: "until", raw: untilRaw }),
    timeoutMs: parseOptionalTimeout({ command: "wait", flags }),
  })
  if (Either.isLeft(combined)) return Either.left(combined.left)
  return Either.right({ _tag: "Wait", ...combined.right, json: flags.has("json"), url })
}

// Shared by send/keys/spawn: an optional `--wait <slug,...>` plus an optional
// `--timeout <ms>` that only makes sense alongside it.
const parseOptionalWait = ({
  command,
  flags,
}: {
  readonly command: string
  readonly flags: ReadonlyMap<string, string>
}): Either.Either<WaitParams | undefined, UsageError> => {
  const raw = flags.get("wait")
  if (raw === undefined) return Either.right(undefined)
  const combined = Either.all({
    until: parseStateSlugList({ command, flag: "wait", raw }),
    timeoutMs: parseOptionalTimeout({ command, flags }),
  })
  return Either.isLeft(combined) ? Either.left(combined.left) : Either.right(combined.right)
}

const parseSendCommand = (
  rest: ReadonlyArray<string>,
  url: string | undefined,
): Either.Either<Command, UsageError> => {
  const scanned = scanArgv({
    command: "send",
    argv: rest,
    flagSpecs: withJson([FLAG_WAIT, FLAG_TIMEOUT]),
  })
  if (Either.isLeft(scanned)) return Either.left(scanned.left)
  const { positionals, flags } = scanned.right
  const shortAndRest = requireShortAndRest({ command: "send", positionals, restLabel: "<text...>" })
  if (Either.isLeft(shortAndRest)) return Either.left(shortAndRest.left)
  const wait = parseOptionalWait({ command: "send", flags })
  if (Either.isLeft(wait)) return Either.left(wait.left)
  return Either.right({
    _tag: "Send",
    short: shortAndRest.right.short,
    text: shortAndRest.right.rest.join(" "),
    wait: wait.right,
    json: flags.has("json"),
    url,
  })
}

const parseKeyNames = (
  names: ReadonlyArray<string>,
): Either.Either<ReadonlyArray<NamedKeyName>, UsageError> => {
  for (const raw of names) {
    if (!isNamedKeyName(raw)) {
      return Either.left(
        usageError(`keys: unknown key name "${raw}" — expected one of: ${NAMED_KEYS_HELP}`),
      )
    }
  }
  return Either.right(names as ReadonlyArray<NamedKeyName>)
}

const parseKeysCommand = (
  rest: ReadonlyArray<string>,
  url: string | undefined,
): Either.Either<Command, UsageError> => {
  const scanned = scanArgv({
    command: "keys",
    argv: rest,
    flagSpecs: withJson([FLAG_WAIT, FLAG_TIMEOUT]),
  })
  if (Either.isLeft(scanned)) return Either.left(scanned.left)
  const { positionals, flags } = scanned.right
  const shortAndRest = requireShortAndRest({
    command: "keys",
    positionals,
    restLabel: "one or more <name>",
  })
  if (Either.isLeft(shortAndRest)) return Either.left(shortAndRest.left)
  const combined = Either.all({
    names: parseKeyNames(shortAndRest.right.rest),
    wait: parseOptionalWait({ command: "keys", flags }),
  })
  if (Either.isLeft(combined)) return Either.left(combined.left)
  return Either.right({
    _tag: "Keys",
    short: shortAndRest.right.short,
    names: combined.right.names,
    wait: combined.right.wait,
    json: flags.has("json"),
    url,
  })
}

const parseOptionalCount = ({
  flags,
}: {
  readonly flags: ReadonlyMap<string, string>
}): Either.Either<number, UsageError> => {
  const raw = flags.get("n")
  return raw === undefined
    ? Either.right(1)
    : parsePositiveInt({ command: "spawn", flag: "n", raw })
}

const parseSpawnCommand = (
  rest: ReadonlyArray<string>,
  url: string | undefined,
): Either.Either<Command, UsageError> => {
  const scanned = scanArgv({
    command: "spawn",
    argv: rest,
    flagSpecs: withJson([FLAG_N, FLAG_AGENT, FLAG_CWD, FLAG_WAIT, FLAG_TIMEOUT]),
  })
  if (Either.isLeft(scanned)) return Either.left(scanned.left)
  const { positionals, flags } = scanned.right
  if (positionals.length === 0)
    return Either.left(usageError("spawn: requires an <intent> argument"))
  const combined = Either.all({
    n: parseOptionalCount({ flags }),
    wait: parseOptionalWait({ command: "spawn", flags }),
  })
  if (Either.isLeft(combined)) return Either.left(combined.left)
  return Either.right({
    _tag: "Spawn",
    intent: positionals.join(" "),
    n: combined.right.n,
    agent: flags.get("agent"),
    cwd: flags.get("cwd"),
    wait: combined.right.wait,
    json: flags.has("json"),
    url,
  })
}

const parseFleetsCommand = (
  rest: ReadonlyArray<string>,
  url: string | undefined,
): Either.Either<Command, UsageError> => {
  const scanned = scanArgv({ command: "fleets", argv: rest, flagSpecs: withJson([FLAG_PROJECT]) })
  if (Either.isLeft(scanned)) return Either.left(scanned.left)
  const { positionals, flags } = scanned.right
  const extra = rejectExtraPositionals({ command: "fleets", positionals, max: 0 })
  if (Either.isLeft(extra)) return Either.left(extra.left)
  return Either.right({
    _tag: "Fleets",
    project: flags.get("project"),
    json: flags.has("json"),
    url,
  })
}

// `fleet run <name>` — the only fleet subcommand with a positional, so it
// gets its own scanArgv call rather than sharing parseFleetsCommand's.
const parseFleetRunCommand = (
  rest: ReadonlyArray<string>,
  url: string | undefined,
): Either.Either<Command, UsageError> => {
  const scanned = scanArgv({
    command: "fleet run",
    argv: rest,
    flagSpecs: withJson([FLAG_PROJECT, FLAG_DRY_RUN, FLAG_FLEET_WAIT]),
  })
  if (Either.isLeft(scanned)) return Either.left(scanned.left)
  const { positionals, flags } = scanned.right
  const name = positionals[0]
  if (name === undefined) return Either.left(usageError("fleet run: requires a <name> argument"))
  const extra = rejectExtraPositionals({ command: "fleet run", positionals, max: 1 })
  if (Either.isLeft(extra)) return Either.left(extra.left)
  return Either.right({
    _tag: "FleetRun",
    name,
    project: flags.get("project"),
    dryRun: flags.has("dry-run"),
    wait: flags.has("wait"),
    json: flags.has("json"),
    url,
  })
}

const parseFleetRunsCommand = (
  rest: ReadonlyArray<string>,
  url: string | undefined,
): Either.Either<Command, UsageError> => {
  const scanned = scanArgv({
    command: "fleet runs",
    argv: rest,
    flagSpecs: withJson([FLAG_PROJECT]),
  })
  if (Either.isLeft(scanned)) return Either.left(scanned.left)
  const { positionals, flags } = scanned.right
  const extra = rejectExtraPositionals({ command: "fleet runs", positionals, max: 0 })
  if (Either.isLeft(extra)) return Either.left(extra.left)
  return Either.right({
    _tag: "FleetRuns",
    project: flags.get("project"),
    json: flags.has("json"),
    url,
  })
}

// `pid fleet <run|runs> ...` is the only two-level command this CLI has —
// dispatched by hand (not through SUBCOMMAND_PARSERS, which is flat by every
// other command's own name) rather than generalizing the table to nested
// subcommands for a single caller.
const parseFleetCommand = (
  rest: ReadonlyArray<string>,
  url: string | undefined,
): Either.Either<Command, UsageError> => {
  const [sub, ...subRest] = rest
  if (sub === "run") return parseFleetRunCommand(subRest, url)
  if (sub === "runs") return parseFleetRunsCommand(subRest, url)
  return Either.left(
    usageError(
      `fleet: unknown subcommand${sub === undefined ? " (expected run|runs)" : `: ${sub}`}`,
    ),
  )
}

const parseShortOnlyCommand = ({
  tag,
  command,
  rest,
  url,
}: {
  readonly tag: "Stop" | "Rm"
  readonly command: string
  readonly rest: ReadonlyArray<string>
  readonly url: string | undefined
}): Either.Either<Command, UsageError> => {
  const scanned = scanArgv({ command, argv: rest, flagSpecs: withJson([]) })
  if (Either.isLeft(scanned)) return Either.left(scanned.left)
  const short = requireSingleShort({ command, positionals: scanned.right.positionals })
  if (Either.isLeft(short)) return Either.left(short.left)
  return Either.right({ _tag: tag, short: short.right, json: scanned.right.flags.has("json"), url })
}

// Pulls `--url <base>` / `--url=<base>` out of the full argv regardless of
// position, so it composes with any subcommand (`pid --url http://h:1 sessions`
// and `pid sessions --url http://h:1` are equivalent) — the single-port
// `pid-dashboard` layout and PID_URL both need this to be a global, not a
// per-subcommand, flag.
const extractUrlFlag = (
  argv: ReadonlyArray<string>,
): { readonly url: string | undefined; readonly rest: ReadonlyArray<string> } => {
  const inlineIdx = argv.findIndex((t) => t.startsWith("--url="))
  if (inlineIdx !== -1) {
    return {
      url: (argv[inlineIdx] ?? "").slice("--url=".length),
      rest: [...argv.slice(0, inlineIdx), ...argv.slice(inlineIdx + 1)],
    }
  }
  const flagIdx = argv.indexOf("--url")
  if (flagIdx === -1) return { url: undefined, rest: argv }
  return { url: argv[flagIdx + 1], rest: [...argv.slice(0, flagIdx), ...argv.slice(flagIdx + 2)] }
}

const hasHelpFlag = (argv: ReadonlyArray<string>): boolean =>
  argv.includes("--help") || argv.includes("-h")

const SUBCOMMAND_PARSERS: Readonly<
  Record<
    string,
    (rest: ReadonlyArray<string>, url: string | undefined) => Either.Either<Command, UsageError>
  >
> = {
  sessions: parseSessionsCommand,
  explain: parseExplainCommand,
  wait: parseWaitCommand,
  send: parseSendCommand,
  keys: parseKeysCommand,
  spawn: parseSpawnCommand,
  stop: (rest, url) => parseShortOnlyCommand({ tag: "Stop", command: "stop", rest, url }),
  rm: (rest, url) => parseShortOnlyCommand({ tag: "Rm", command: "rm", rest, url }),
  fleets: parseFleetsCommand,
  fleet: parseFleetCommand,
}

// `rest` is always non-empty here (parseAgentArgv only calls this once the
// empty/help cases are handled), so `sub` is always a real command name —
// the `sub === undefined` arm exists only to satisfy `noUncheckedIndexedAccess`
// on the destructure, the same unreachable-in-practice shape as scanStep's
// "index out of range" arm above.
const dispatchSubcommand = ({
  rest,
  url,
}: {
  readonly rest: ReadonlyArray<string>
  readonly url: string | undefined
}): Either.Either<Command, UsageError> => {
  const [sub, ...subRest] = rest
  if (sub === undefined) return Either.left(usageError("unknown command"))
  const parser = SUBCOMMAND_PARSERS[sub]
  return parser ? parser(subRest, url) : Either.left(usageError(`unknown command: ${sub}`))
}

// Parses `process.argv.slice(2)`. `--url`/`--help`/`-h` are recognised
// anywhere in the invocation; everything else is dispatched to the named
// subcommand's own parser (looked up in a table, not a switch, to keep the
// dispatch step's own branch count low as the command surface grows). An
// empty invocation, or one carrying --help/-h (anywhere), always resolves to
// the Help command rather than a UsageError — asking for help is never a
// mistake.
export const parseAgentArgv = (argv: ReadonlyArray<string>): Either.Either<Command, UsageError> => {
  const { url, rest } = extractUrlFlag(argv)
  if (rest.length === 0 || hasHelpFlag(rest)) return Either.right({ _tag: "Help", url })
  return dispatchSubcommand({ rest, url })
}

// --- Base URL resolution ------------------------------------------------------

export const DEFAULT_PID_URL = "http://localhost:8787"

// --flag wins over PID_URL wins over the default. Pure precedence — the shell
// reads the PID_URL environment variable (main.ts is a sanctioned composition
// root) and passes it in; this function never touches the environment itself.
export const resolveBaseUrl = ({
  flag,
  env,
}: {
  readonly flag: string | undefined
  readonly env: string | undefined
}): string => flag ?? env ?? DEFAULT_PID_URL

// The `pid-dashboard` single-port layout moves the API behind `/__api` (see
// apps/daemon/src/api.ts buildApp); the dev daemon serves it at the bare root.
// `bareOk` is the shell's probe of `GET <url>/health` — true selects the bare
// base, false assumes the `/__api` layout (a second probe would only delay
// the same failure the real request will report anyway).
const API_SUFFIX = "/__api"

export const resolveApiBase = ({
  url,
  bareOk,
}: {
  readonly url: string
  readonly bareOk: boolean
}): string => (bareOk ? url : `${url}${API_SUFFIX}`)

// --- Exit codes ---------------------------------------------------------------

// 7 is `fleet run --wait`'s own outcome: the run finished but at least one
// step failed or was skipped. None of 3-6 fit — those are single-wait
// outcomes, and a fleet run's failure can stem from any of them (or a spawn
// rejection, or a skip cascade) rolled into one run-level verdict — so this
// is a genuinely new outcome, not a rename of an existing one.
export type ExitCode = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7

export const exitCodeForUsage = (): ExitCode => 2

export type WaitFailureReason = "timeout" | "occupant_changed" | "removed" | "not_found"

export type WaitOutcomeBody =
  | {
      readonly ok: true
      readonly short: string
      readonly state: SessionStateSlug
      readonly waitedMs: number
    }
  | {
      readonly ok: false
      readonly short: string
      readonly reason: WaitFailureReason
      readonly waitedMs: number | undefined
    }

const WAIT_FAILURE_EXIT: Readonly<Record<WaitFailureReason, ExitCode>> = {
  timeout: 3,
  occupant_changed: 4,
  removed: 5,
  not_found: 6,
}

export const exitCodeForWaitBody = (body: WaitOutcomeBody): ExitCode =>
  body.ok ? 0 : WAIT_FAILURE_EXIT[body.reason]

const exitCodeForOk = (wait: WaitOutcomeBody | undefined): ExitCode =>
  wait === undefined ? 0 : exitCodeForWaitBody(wait)

// The single result shape every request/response cycle below reduces to,
// after the shell has read the HTTP status and decoded the body: a clean
// success (possibly carrying a nested wait outcome, for send/keys/wait
// itself), a 404, or anything else (a non-2xx status, a network failure
// surfaced upstream, or a body this CLI's parser could not make sense of).
export type CommandOutcome =
  | { readonly _tag: "Ok"; readonly wait: WaitOutcomeBody | undefined }
  | { readonly _tag: "NotFound" }
  | { readonly _tag: "HttpError" }

export const exitCodeForOutcome = (outcome: CommandOutcome): ExitCode => {
  switch (outcome._tag) {
    case "Ok":
      return exitCodeForOk(outcome.wait)
    case "NotFound":
      return 6
    case "HttpError":
      return 1
  }
}

// Severity order for picking the worst of several outcomes (`spawn --wait`
// waits on every spawned short and reports the worst). Ranked by how much the
// caller's picture of what happened is degraded: a plain timeout still means
// "it's out there, just slow"; a transport/unexpected failure means the
// caller does not actually know what happened at all, which is worse than any
// of the wait-specific failures.
const SEVERITY_RANK: Readonly<Record<ExitCode, number>> = {
  0: 0,
  3: 1,
  4: 2,
  5: 3,
  6: 4,
  // A fleet run failure is a rolled-up verdict ("something in the run did
  // not succeed") rather than a specific diagnosis, so it ranks worse than
  // knowing exactly which single-wait outcome occurred, but better than not
  // even knowing that much (1) or a plain usage error (2). worstExitCode
  // itself is not used by any fleet-run command today — this entry exists so
  // ExitCode's Record stays total.
  7: 4.5,
  1: 5,
  2: 6,
}

export const worstExitCode = (codes: ReadonlyArray<ExitCode>): ExitCode => {
  let worst: ExitCode = 0
  for (const code of codes) {
    if (SEVERITY_RANK[code] > SEVERITY_RANK[worst]) worst = code
  }
  return worst
}

// --- Response parsing ---------------------------------------------------------
//
// Every daemon response arrives as `unknown`; these turn it into a typed
// value or a ParseError — never a cast, never a crash. A daemon that returns
// something this CLI doesn't recognise is a ParseError (exit 1 via
// HttpError), not a silent best-effort guess.

export type ParseError = { readonly _tag: "ParseError"; readonly message: string }

const parseError = (message: string): ParseError => ({ _tag: "ParseError", message })

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)

const isNonEmptyString = (v: unknown): v is string => typeof v === "string" && v.length > 0

const optionalString = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined)

const optionalNumber = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined)

const optionalBoolean = (v: unknown): boolean | undefined =>
  typeof v === "boolean" ? v : undefined

// One field validator per shape, each a total function from `unknown` (plus a
// message) to an Either — combined via `Either.all` by the callers below so
// validating N required fields costs the caller exactly one branch, not N.
const requireNonEmptyStringField = ({
  value,
  message,
}: {
  readonly value: unknown
  readonly message: string
}): Either.Either<string, ParseError> =>
  isNonEmptyString(value) ? Either.right(value) : Either.left(parseError(message))

const requireStringField = ({
  value,
  message,
}: {
  readonly value: unknown
  readonly message: string
}): Either.Either<string, ParseError> =>
  typeof value === "string" ? Either.right(value) : Either.left(parseError(message))

const requireBooleanField = ({
  value,
  message,
}: {
  readonly value: unknown
  readonly message: string
}): Either.Either<boolean, ParseError> =>
  typeof value === "boolean" ? Either.right(value) : Either.left(parseError(message))

const requireNumberField = ({
  value,
  message,
}: {
  readonly value: unknown
  readonly message: string
}): Either.Either<number, ParseError> =>
  typeof value === "number" ? Either.right(value) : Either.left(parseError(message))

const requireOkTrue = ({
  value,
  message,
}: {
  readonly value: unknown
  readonly message: string
}): Either.Either<true, ParseError> =>
  value === true ? Either.right(true) : Either.left(parseError(message))

const requireStateSlugField = ({
  value,
  message,
}: {
  readonly value: unknown
  readonly message: string
}): Either.Either<SessionStateSlug, ParseError> =>
  typeof value === "string" && isSessionStateSlug(value)
    ? Either.right(value)
    : Either.left(parseError(message))

const requireStringArrayField = ({
  value,
  message,
}: {
  readonly value: unknown
  readonly message: string
}): Either.Either<ReadonlyArray<string>, ParseError> =>
  Array.isArray(value) && value.every((v) => typeof v === "string")
    ? Either.right(value)
    : Either.left(parseError(message))

const WAIT_FAILURE_REASONS: ReadonlyArray<WaitFailureReason> = [
  "timeout",
  "occupant_changed",
  "removed",
  "not_found",
]

const isWaitFailureReason = (v: unknown): v is WaitFailureReason =>
  typeof v === "string" && (WAIT_FAILURE_REASONS as readonly string[]).includes(v)

const requireShortFrom = (
  raw: unknown,
): Either.Either<{ readonly obj: Record<string, unknown>; readonly short: string }, ParseError> => {
  if (!isPlainObject(raw)) return Either.left(parseError("wait response must be an object"))
  const short = requireNonEmptyStringField({
    value: raw.short,
    message: "wait response is missing short",
  })
  return Either.isLeft(short)
    ? Either.left(short.left)
    : Either.right({ obj: raw, short: short.right })
}

const parseSatisfiedWait = (
  obj: Record<string, unknown>,
  short: string,
): Either.Either<WaitOutcomeBody, ParseError> => {
  const combined = Either.all({
    state: requireStateSlugField({
      value: obj.state,
      message: `wait response has an unrecognized state: ${JSON.stringify(obj.state)}`,
    }),
    waitedMs: requireNumberField({
      value: obj.waitedMs,
      message: "wait response is missing waitedMs",
    }),
  })
  return Either.isLeft(combined)
    ? Either.left(combined.left)
    : Either.right({ ok: true, short, ...combined.right })
}

const parseFailedWait = (
  obj: Record<string, unknown>,
  short: string,
): Either.Either<WaitOutcomeBody, ParseError> => {
  if (!isWaitFailureReason(obj.reason)) {
    return Either.left(
      parseError(`wait response has an unrecognized reason: ${JSON.stringify(obj.reason)}`),
    )
  }
  return Either.right({
    ok: false,
    short,
    reason: obj.reason,
    waitedMs: optionalNumber(obj.waitedMs),
  })
}

export const parseWaitOutcomeBody = (raw: unknown): Either.Either<WaitOutcomeBody, ParseError> => {
  const base = requireShortFrom(raw)
  if (Either.isLeft(base)) return Either.left(base.left)
  const { obj, short } = base.right
  if (obj.ok === true) return parseSatisfiedWait(obj, short)
  if (obj.ok === false) return parseFailedWait(obj, short)
  return Either.left(parseError("wait response is missing ok"))
}

const parseOptionalWaitField = (
  value: unknown,
): Either.Either<WaitOutcomeBody | undefined, ParseError> =>
  value === undefined ? Either.right(undefined) : parseWaitOutcomeBody(value)

export type SendResult = { readonly short: string; readonly wait: WaitOutcomeBody | undefined }

export const parseSendResponse = (raw: unknown): Either.Either<SendResult, ParseError> => {
  if (!isPlainObject(raw)) return Either.left(parseError("send response must be an object"))
  const combined = Either.all({
    short: requireNonEmptyStringField({
      value: raw.short,
      message: "send response is missing ok/short",
    }),
    ok: requireOkTrue({ value: raw.ok, message: "send response is missing ok/short" }),
    wait: parseOptionalWaitField(raw.wait),
  })
  if (Either.isLeft(combined)) return Either.left(combined.left)
  return Either.right({ short: combined.right.short, wait: combined.right.wait })
}

export type KeysResult = SendResult & {
  readonly resolved: ReadonlyArray<string>
  readonly bytes: number
}

export const parseKeysResponse = (raw: unknown): Either.Either<KeysResult, ParseError> => {
  if (!isPlainObject(raw)) return Either.left(parseError("keys response must be an object"))
  const combined = Either.all({
    short: requireNonEmptyStringField({
      value: raw.short,
      message: "keys response is missing ok/short",
    }),
    ok: requireOkTrue({ value: raw.ok, message: "keys response is missing ok/short" }),
    resolved: requireStringArrayField({
      value: raw.resolved,
      message: "keys response is missing resolved",
    }),
    bytes: requireNumberField({ value: raw.bytes, message: "keys response is missing bytes" }),
    wait: parseOptionalWaitField(raw.wait),
  })
  if (Either.isLeft(combined)) return Either.left(combined.left)
  return Either.right({
    short: combined.right.short,
    resolved: combined.right.resolved,
    bytes: combined.right.bytes,
    wait: combined.right.wait,
  })
}

export type OkShortResult = { readonly short: string }

export const parseOkShortResponse = (raw: unknown): Either.Either<OkShortResult, ParseError> => {
  if (!isPlainObject(raw)) return Either.left(parseError("response must be an object"))
  const combined = Either.all({
    short: requireNonEmptyStringField({
      value: raw.short,
      message: "response is missing ok/short",
    }),
    ok: requireOkTrue({ value: raw.ok, message: "response is missing ok/short" }),
  })
  return Either.isLeft(combined)
    ? Either.left(combined.left)
    : Either.right({ short: combined.right.short })
}

export const parseDispatchResponse = (raw: unknown): Either.Either<OkShortResult, ParseError> => {
  if (!isPlainObject(raw)) return Either.left(parseError("dispatch response must be an object"))
  const short = requireNonEmptyStringField({
    value: raw.short,
    message: "dispatch response is missing short",
  })
  return Either.isLeft(short) ? Either.left(short.left) : Either.right({ short: short.right })
}

// A session-list entry, as returned by GET /sessions. `createdAt` is kept as
// the raw ISO string the daemon sends — the core does not read the clock, so
// converting it to an age is the shell's job (see formatSessions below, which
// takes an already-resolved `now`).
export type SessionListEntry = {
  readonly short: string
  readonly state: SessionStateSlug
  readonly intent: string | undefined
  readonly createdAt: string | undefined
}

const normalizeListedState = (state: unknown): SessionStateSlug =>
  typeof state === "string" && isSessionStateSlug(state) ? state : "unknown"

// A single malformed entry degrades to "unknown" state rather than failing
// the whole list — GET /sessions already normalizes an unrecognized slug the
// same way (see sessions.core.ts normalizeState). An entry with no `short` at
// all cannot be shown, so it is dropped instead of aborting the entire list.
const parseSessionListItem = (item: unknown): SessionListEntry | undefined => {
  if (!isPlainObject(item)) return undefined
  const { short, state, intent, createdAt } = item
  if (!isNonEmptyString(short)) return undefined
  return {
    short,
    state: normalizeListedState(state),
    intent: optionalString(intent),
    createdAt: optionalString(createdAt),
  }
}

export const parseSessionsResponse = (
  raw: unknown,
): Either.Either<ReadonlyArray<SessionListEntry>, ParseError> => {
  if (!Array.isArray(raw)) return Either.left(parseError("sessions response must be an array"))
  const entries = raw
    .map(parseSessionListItem)
    .filter((e): e is SessionListEntry => e !== undefined)
  return Either.right(entries)
}

export type ExplainSummary = {
  readonly short: string
  readonly state: SessionStateSlug
  readonly source: string
  readonly degradedFrom: string | undefined
  readonly updatedAtAgeMs: number | undefined
  readonly lastEventAgeMs: number | undefined
  readonly pidAlive: boolean | undefined
  readonly stateFilePresent: boolean
  readonly stale: boolean
  readonly reasons: ReadonlyArray<string>
}

export const parseExplainResponse = (raw: unknown): Either.Either<ExplainSummary, ParseError> => {
  if (!isPlainObject(raw)) return Either.left(parseError("explain response must be an object"))
  const combined = Either.all({
    short: requireNonEmptyStringField({
      value: raw.short,
      message: "explain response is missing short",
    }),
    state: requireStateSlugField({
      value: raw.state,
      message: `explain response has an unrecognized state: ${JSON.stringify(raw.state)}`,
    }),
    source: requireStringField({
      value: raw.source,
      message: "explain response is missing source",
    }),
    stateFilePresent: requireBooleanField({
      value: raw.stateFilePresent,
      message: "explain response is missing stateFilePresent",
    }),
    stale: requireBooleanField({ value: raw.stale, message: "explain response is missing stale" }),
    reasons: requireStringArrayField({
      value: raw.reasons,
      message: "explain response is missing reasons",
    }),
  })
  if (Either.isLeft(combined)) return Either.left(combined.left)
  return Either.right({
    ...combined.right,
    degradedFrom: optionalString(raw.degradedFrom),
    updatedAtAgeMs: optionalNumber(raw.updatedAtAgeMs),
    lastEventAgeMs: optionalNumber(raw.lastEventAgeMs),
    pidAlive: optionalBoolean(raw.pidAlive),
  })
}

// --- Fleet recipes (GET /projects/:id/fleets) --------------------------------
//
// Schema + validation + wave planning only — there is no runner yet (see
// AGENTS.md "Fleet recipes"). `SessionStateSlug` above already covers `until`.

export type FleetErrorSummary = {
  readonly fleet: string
  readonly step: string | undefined
  readonly message: string
}

export type FleetStepSummary = {
  readonly id: string
  readonly intent: string
  readonly n: number
  readonly agent: string | undefined
  readonly cwd: string | undefined
  readonly needs: ReadonlyArray<string>
  readonly until: ReadonlyArray<SessionStateSlug> | undefined
  readonly timeoutMs: number | undefined
}

export type FleetSummary = {
  readonly name: string
  readonly description: string | undefined
  readonly steps: ReadonlyArray<FleetStepSummary>
  readonly waves: ReadonlyArray<ReadonlyArray<string>>
}

export type FleetsResponse = {
  readonly fleets: ReadonlyArray<FleetSummary>
  readonly errors: ReadonlyArray<FleetErrorSummary>
}

const requireWaveArrayField = ({
  value,
  message,
}: {
  readonly value: unknown
  readonly message: string
}): Either.Either<ReadonlyArray<ReadonlyArray<string>>, ParseError> =>
  Array.isArray(value) && value.every((wave) => Array.isArray(wave) && wave.every(isNonEmptyString))
    ? Either.right(value)
    : Either.left(parseError(message))

// Split out of parseFleetStep to keep that function's own branch count low
// (fallow's complexity gate) — this is the only field whose validation needs
// more than a single requireXField call.
const parseFleetStepUntil = (
  raw: Record<string, unknown>,
): Either.Either<ReadonlyArray<SessionStateSlug> | undefined, ParseError> => {
  if (raw.until === undefined) return Either.right(undefined)
  return requireStringArrayField({
    value: raw.until,
    message: "fleet step has an invalid until",
  }).pipe(
    Either.filterOrLeft(
      (slugs): slugs is ReadonlyArray<SessionStateSlug> => slugs.every(isSessionStateSlug),
      () => parseError("fleet step until contains an unrecognized state"),
    ),
  )
}

const parseFleetStep = (raw: unknown): Either.Either<FleetStepSummary, ParseError> => {
  if (!isPlainObject(raw)) return Either.left(parseError("fleet step must be an object"))
  const combined = Either.all({
    id: requireNonEmptyStringField({ value: raw.id, message: "fleet step is missing id" }),
    intent: requireNonEmptyStringField({
      value: raw.intent,
      message: "fleet step is missing intent",
    }),
    n: requireNumberField({ value: raw.n, message: "fleet step is missing n" }),
    needs: requireStringArrayField({ value: raw.needs, message: "fleet step is missing needs" }),
    until: parseFleetStepUntil(raw),
  })
  if (Either.isLeft(combined)) return Either.left(combined.left)
  return Either.right({
    ...combined.right,
    agent: optionalString(raw.agent),
    cwd: optionalString(raw.cwd),
    timeoutMs: optionalNumber(raw.timeoutMs),
  })
}

const parseFleetSummary = (raw: unknown): Either.Either<FleetSummary, ParseError> => {
  if (!isPlainObject(raw)) return Either.left(parseError("fleet must be an object"))
  const combined = Either.all({
    name: requireNonEmptyStringField({ value: raw.name, message: "fleet is missing name" }),
    steps: Array.isArray(raw.steps)
      ? Either.all(raw.steps.map(parseFleetStep))
      : Either.left(parseError("fleet is missing steps")),
    waves: requireWaveArrayField({ value: raw.waves, message: "fleet is missing waves" }),
  })
  if (Either.isLeft(combined)) return Either.left(combined.left)
  return Either.right({ ...combined.right, description: optionalString(raw.description) })
}

const parseFleetError = (raw: unknown): Either.Either<FleetErrorSummary, ParseError> => {
  if (!isPlainObject(raw)) return Either.left(parseError("fleet error must be an object"))
  const combined = Either.all({
    fleet: requireNonEmptyStringField({
      value: raw.fleet,
      message: "fleet error is missing fleet",
    }),
    message: requireNonEmptyStringField({
      value: raw.message,
      message: "fleet error is missing message",
    }),
  })
  if (Either.isLeft(combined)) return Either.left(combined.left)
  return Either.right({ ...combined.right, step: optionalString(raw.step) })
}

export const parseFleetsResponse = (raw: unknown): Either.Either<FleetsResponse, ParseError> => {
  if (!isPlainObject(raw)) return Either.left(parseError("fleets response must be an object"))
  const combined = Either.all({
    fleets: Array.isArray(raw.fleets)
      ? Either.all(raw.fleets.map(parseFleetSummary))
      : Either.left(parseError("fleets response is missing fleets")),
    errors: Array.isArray(raw.errors)
      ? Either.all(raw.errors.map(parseFleetError))
      : Either.left(parseError("fleets response is missing errors")),
  })
  return combined
}

// --- Fleet runs (POST .../fleets/:name/run, GET .../fleet-runs[/:runId]) ----
//
// The daemon's wave/step wire shape for a run's plan is identical to
// FleetStepSummary above (the routes layer keys it `id` rather than `stepId`
// on purpose — see fleet.routes.ts's `toWireStep`), so parseFleetStep is
// reused rather than duplicated.

export type FleetRunPlanSummary = {
  readonly fleet: string
  readonly waves: ReadonlyArray<ReadonlyArray<FleetStepSummary>>
  readonly totalSessions: number
  readonly maxConcurrentSpawns: number
}

const requireStepWaveArrayField = (
  value: unknown,
  message: string,
): Either.Either<ReadonlyArray<ReadonlyArray<FleetStepSummary>>, ParseError> =>
  Array.isArray(value)
    ? Either.all(
        value.map((wave) =>
          Array.isArray(wave)
            ? Either.all(wave.map(parseFleetStep))
            : Either.left(parseError(message)),
        ),
      )
    : Either.left(parseError(message))

// Not exported: only parseFleetDryRunResponse below needs it directly, and an
// unconsumed export is dead code by `fallow audit`'s own reading.
const parseFleetRunPlan = (raw: unknown): Either.Either<FleetRunPlanSummary, ParseError> => {
  if (!isPlainObject(raw)) return Either.left(parseError("fleet run plan must be an object"))
  return Either.all({
    fleet: requireNonEmptyStringField({
      value: raw.fleet,
      message: "fleet run plan is missing fleet",
    }),
    waves: requireStepWaveArrayField(raw.waves, "fleet run plan has invalid waves"),
    totalSessions: requireNumberField({
      value: raw.totalSessions,
      message: "fleet run plan is missing totalSessions",
    }),
    maxConcurrentSpawns: requireNumberField({
      value: raw.maxConcurrentSpawns,
      message: "fleet run plan is missing maxConcurrentSpawns",
    }),
  })
}

export type FleetDryRunResult = { readonly plan: FleetRunPlanSummary }

export const parseFleetDryRunResponse = (
  raw: unknown,
): Either.Either<FleetDryRunResult, ParseError> => {
  if (!isPlainObject(raw)) return Either.left(parseError("dry run response must be an object"))
  const plan = parseFleetRunPlan(raw.plan)
  return Either.isLeft(plan) ? Either.left(plan.left) : Either.right({ plan: plan.right })
}

export type FleetRunStarted = {
  readonly runId: string
  readonly waves: ReadonlyArray<ReadonlyArray<FleetStepSummary>>
  readonly totalSessions: number
}

export const parseFleetRunStarted = (raw: unknown): Either.Either<FleetRunStarted, ParseError> => {
  if (!isPlainObject(raw)) return Either.left(parseError("fleet run response must be an object"))
  return Either.all({
    runId: requireNonEmptyStringField({
      value: raw.runId,
      message: "fleet run response is missing runId",
    }),
    waves: requireStepWaveArrayField(raw.waves, "fleet run response has invalid waves"),
    totalSessions: requireNumberField({
      value: raw.totalSessions,
      message: "fleet run response is missing totalSessions",
    }),
  })
}

// --- Fleet run status (GET .../fleet-runs[/:runId]) --------------------------

export type FleetRunStepStatus = "pending" | "spawning" | "waiting" | "done" | "failed" | "skipped"

const FLEET_RUN_STEP_STATUSES: ReadonlyArray<FleetRunStepStatus> = [
  "pending",
  "spawning",
  "waiting",
  "done",
  "failed",
  "skipped",
]

const isFleetRunStepStatus = (v: unknown): v is FleetRunStepStatus =>
  typeof v === "string" && (FLEET_RUN_STEP_STATUSES as readonly string[]).includes(v)

export type FleetRunStatus = "running" | "done" | "failed"

const FLEET_RUN_STATUSES: ReadonlyArray<FleetRunStatus> = ["running", "done", "failed"]

const isFleetRunStatus = (v: unknown): v is FleetRunStatus =>
  typeof v === "string" && (FLEET_RUN_STATUSES as readonly string[]).includes(v)

// Mirrors WaitOutcomeLike in
// apps/daemon/src/features/fleet/fleet-run.core.ts on the wire — see that
// file's own comment for why it is a literal copy rather than an import
// (apps/cli cannot deep-import a daemon slice-internal module at all, the
// same limitation SessionStateSlug/NamedKeyName above document).
export type FleetWaitOutcomeWire =
  | { readonly _tag: "Satisfied"; readonly state: SessionStateSlug; readonly waitedMs: number }
  | { readonly _tag: "Timeout"; readonly waitedMs: number }
  | { readonly _tag: "OccupantChanged" }
  | { readonly _tag: "Removed" }
  | { readonly _tag: "NotFound" }

const FLEET_WAIT_TAGS: ReadonlyArray<FleetWaitOutcomeWire["_tag"]> = [
  "Satisfied",
  "Timeout",
  "OccupantChanged",
  "Removed",
  "NotFound",
]

const isFleetWaitTag = (v: unknown): v is FleetWaitOutcomeWire["_tag"] =>
  typeof v === "string" && (FLEET_WAIT_TAGS as readonly string[]).includes(v)

const parseFleetWaitTimeout = (raw: Record<string, unknown>): Either.Either<number, ParseError> =>
  requireNumberField({ value: raw.waitedMs, message: "fleet run wait outcome is missing waitedMs" })

const parseFleetWaitSatisfied = (
  raw: Record<string, unknown>,
): Either.Either<FleetWaitOutcomeWire, ParseError> => {
  const combined = Either.all({
    state: requireStateSlugField({
      value: raw.state,
      message: `fleet run wait outcome has an unrecognized state: ${JSON.stringify(raw.state)}`,
    }),
    waitedMs: parseFleetWaitTimeout(raw),
  })
  return Either.isLeft(combined)
    ? Either.left(combined.left)
    : Either.right({ _tag: "Satisfied", ...combined.right })
}

const parseFleetWaitTimeoutOutcome = (
  raw: Record<string, unknown>,
): Either.Either<FleetWaitOutcomeWire, ParseError> => {
  const waitedMs = parseFleetWaitTimeout(raw)
  return Either.isLeft(waitedMs)
    ? Either.left(waitedMs.left)
    : Either.right({ _tag: "Timeout", waitedMs: waitedMs.right })
}

// Table dispatch (see EVENT_HANDLERS-style precedent in
// apps/daemon/src/features/fleet/fleet-run.core.ts's own applyEvent) rather
// than an if-chain per tag — keeps parseFleetWaitOutcome itself down to a
// single guard clause plus the lookup.
const FLEET_WAIT_PARSERS: Readonly<
  Record<
    FleetWaitOutcomeWire["_tag"],
    (raw: Record<string, unknown>) => Either.Either<FleetWaitOutcomeWire, ParseError>
  >
> = {
  Satisfied: parseFleetWaitSatisfied,
  Timeout: parseFleetWaitTimeoutOutcome,
  OccupantChanged: () => Either.right({ _tag: "OccupantChanged" }),
  Removed: () => Either.right({ _tag: "Removed" }),
  NotFound: () => Either.right({ _tag: "NotFound" }),
}

const parseFleetWaitOutcome = (raw: unknown): Either.Either<FleetWaitOutcomeWire, ParseError> => {
  if (!isPlainObject(raw) || !isFleetWaitTag(raw._tag)) {
    return Either.left(parseError("fleet run wait outcome has an unrecognized shape"))
  }
  return FLEET_WAIT_PARSERS[raw._tag](raw)
}

export type FleetRunShortWire = {
  readonly short: string
  readonly wait: FleetWaitOutcomeWire | undefined
}

const parseOptionalFleetWaitOutcome = (
  value: unknown,
): Either.Either<FleetWaitOutcomeWire | undefined, ParseError> =>
  value === undefined ? Either.right(undefined) : parseFleetWaitOutcome(value)

const parseFleetRunShort = (raw: unknown): Either.Either<FleetRunShortWire, ParseError> => {
  if (!isPlainObject(raw)) return Either.left(parseError("fleet run short must be an object"))
  return Either.all({
    short: requireNonEmptyStringField({
      value: raw.short,
      message: "fleet run short is missing short",
    }),
    wait: parseOptionalFleetWaitOutcome(raw.wait),
  })
}

export type FleetRunStepState = {
  readonly stepId: string
  readonly waveIndex: number
  readonly intent: string
  readonly n: number
  readonly status: FleetRunStepStatus
  readonly shorts: ReadonlyArray<FleetRunShortWire>
  readonly reason: string | undefined
}

const requireFleetRunStepStatusField = ({
  value,
  message,
}: {
  readonly value: unknown
  readonly message: string
}): Either.Either<FleetRunStepStatus, ParseError> =>
  isFleetRunStepStatus(value) ? Either.right(value) : Either.left(parseError(message))

const requireFleetRunShortsField = (
  value: unknown,
  message: string,
): Either.Either<ReadonlyArray<FleetRunShortWire>, ParseError> =>
  Array.isArray(value)
    ? Either.all(value.map(parseFleetRunShort))
    : Either.left(parseError(message))

const parseFleetRunStepState = (raw: unknown): Either.Either<FleetRunStepState, ParseError> => {
  if (!isPlainObject(raw)) return Either.left(parseError("fleet run step must be an object"))
  const combined = Either.all({
    stepId: requireNonEmptyStringField({
      value: raw.stepId,
      message: "fleet run step is missing stepId",
    }),
    waveIndex: requireNumberField({
      value: raw.waveIndex,
      message: "fleet run step is missing waveIndex",
    }),
    intent: requireNonEmptyStringField({
      value: raw.intent,
      message: "fleet run step is missing intent",
    }),
    n: requireNumberField({ value: raw.n, message: "fleet run step is missing n" }),
    status: requireFleetRunStepStatusField({
      value: raw.status,
      message: `fleet run step has an unrecognized status: ${JSON.stringify(raw.status)}`,
    }),
    shorts: requireFleetRunShortsField(raw.shorts, "fleet run step is missing shorts"),
  })
  if (Either.isLeft(combined)) return Either.left(combined.left)
  return Either.right({ ...combined.right, reason: optionalString(raw.reason) })
}

export type FleetRunSummaryWire = {
  readonly id: string
  readonly projectId: string
  readonly fleet: string
  readonly status: FleetRunStatus
  readonly totalSessions: number
  readonly startedAt: number
  readonly finishedAt: number | undefined
  readonly steps: ReadonlyArray<FleetRunStepState>
}

const requireFleetRunStatusField = ({
  value,
  message,
}: {
  readonly value: unknown
  readonly message: string
}): Either.Either<FleetRunStatus, ParseError> =>
  isFleetRunStatus(value) ? Either.right(value) : Either.left(parseError(message))

const requireFleetRunStepStateArrayField = (
  value: unknown,
  message: string,
): Either.Either<ReadonlyArray<FleetRunStepState>, ParseError> =>
  Array.isArray(value)
    ? Either.all(value.map(parseFleetRunStepState))
    : Either.left(parseError(message))

export const parseFleetRunSummary = (
  raw: unknown,
): Either.Either<FleetRunSummaryWire, ParseError> => {
  if (!isPlainObject(raw)) return Either.left(parseError("fleet run summary must be an object"))
  const combined = Either.all({
    id: requireNonEmptyStringField({ value: raw.id, message: "fleet run summary is missing id" }),
    projectId: requireNonEmptyStringField({
      value: raw.projectId,
      message: "fleet run summary is missing projectId",
    }),
    fleet: requireNonEmptyStringField({
      value: raw.fleet,
      message: "fleet run summary is missing fleet",
    }),
    status: requireFleetRunStatusField({
      value: raw.status,
      message: `fleet run summary has an unrecognized status: ${JSON.stringify(raw.status)}`,
    }),
    totalSessions: requireNumberField({
      value: raw.totalSessions,
      message: "fleet run summary is missing totalSessions",
    }),
    startedAt: requireNumberField({
      value: raw.startedAt,
      message: "fleet run summary is missing startedAt",
    }),
    steps: requireFleetRunStepStateArrayField(raw.steps, "fleet run summary is missing steps"),
  })
  if (Either.isLeft(combined)) return Either.left(combined.left)
  return Either.right({ ...combined.right, finishedAt: optionalNumber(raw.finishedAt) })
}

export const parseFleetRunsResponse = (
  raw: unknown,
): Either.Either<ReadonlyArray<FleetRunSummaryWire>, ParseError> => {
  if (!isPlainObject(raw) || !Array.isArray(raw.runs)) {
    return Either.left(parseError("fleet runs response must have a runs array"))
  }
  return Either.all(raw.runs.map(parseFleetRunSummary))
}

// `fleet run --wait` follows a run to one of these two terminal statuses
// (GET .../fleet-runs/:runId never reports "running" as a final poll result —
// main.ts keeps polling until it isn't).
export const exitCodeForFleetRunStatus = (status: FleetRunStatus): ExitCode =>
  status === "done" ? 0 : 7

// Best-effort human message out of a daemon error body — every error route in
// this app responds with some subset of { error, message, detail }.
export const errorMessageFrom = (raw: unknown): string => {
  if (!isPlainObject(raw)) return "unknown error"
  const candidates = [raw.message, raw.detail, raw.error].map((v) =>
    typeof v === "string" && v.length > 0 ? v : undefined,
  )
  return candidates.find((c): c is string => c !== undefined) ?? "unknown error"
}

// --- Request body building ----------------------------------------------------

export const buildWaitRequestBody = (
  wait: WaitParams,
): { readonly until: ReadonlyArray<SessionStateSlug>; readonly timeoutMs?: number } =>
  wait.timeoutMs === undefined
    ? { until: wait.until }
    : { until: wait.until, timeoutMs: wait.timeoutMs }

export const buildSendRequestBody = ({
  keys,
  wait,
}: {
  readonly keys: string
  readonly wait: WaitParams | undefined
}): Record<string, unknown> =>
  wait === undefined ? { keys } : { keys, wait: buildWaitRequestBody(wait) }

export const buildKeysRequestBody = ({
  names,
  wait,
}: {
  readonly names: ReadonlyArray<NamedKeyName>
  readonly wait: WaitParams | undefined
}): Record<string, unknown> => {
  const sequence = names.map((named) => ({ named }))
  return wait === undefined ? { sequence } : { sequence, wait: buildWaitRequestBody(wait) }
}

export const buildDispatchRequestBody = ({
  intent,
  cwd,
  agent,
}: {
  readonly intent: string
  readonly cwd: string | undefined
  readonly agent: string | undefined
}): Record<string, unknown> => {
  const body: Record<string, unknown> = { intent }
  if (cwd !== undefined) body.cwd = cwd
  if (agent !== undefined) body.agent = agent
  return body
}

export const buildFleetRunRequestBody = ({
  dryRun,
}: {
  readonly dryRun: boolean
}): Record<string, unknown> => ({ dryRun })

// --- Output formatting ---------------------------------------------------------

const ageMs = ({
  now,
  sinceMs,
}: {
  readonly now: number
  readonly sinceMs: number | undefined
}): number | undefined =>
  sinceMs === undefined || Number.isNaN(sinceMs) ? undefined : Math.max(0, now - sinceMs)

// A ladder of (limit-in-seconds, divisor, suffix) triples, checked in order —
// adding a unit later is one new row, not another branch in formatAge itself.
const AGE_LADDER: ReadonlyArray<{
  readonly below: number
  readonly divisor: number
  readonly suffix: string
}> = [
  { below: 60, divisor: 1, suffix: "s" },
  { below: 60 * 60, divisor: 60, suffix: "m" },
  { below: 60 * 60 * 24, divisor: 60 * 60, suffix: "h" },
]

const formatAge = (ms: number | undefined): string => {
  if (ms === undefined) return "—"
  const s = Math.floor(ms / 1000)
  const unit = AGE_LADDER.find((u) => s < u.below)
  if (unit === undefined) return `${Math.floor(s / (60 * 60 * 24))}d`
  return `${Math.floor(s / unit.divisor)}${unit.suffix}`
}

const truncate = ({ text, max }: { readonly text: string; readonly max: number }): string =>
  text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`

const padEndTo = ({ text, width }: { readonly text: string; readonly width: number }): string =>
  text.length >= width ? text : text + " ".repeat(width - text.length)

// A session row ready for column formatting: `createdAtMs` is the shell's
// `Date.parse` of the raw ISO `createdAt` a SessionListEntry carries — the
// core never touches the clock or a date parser, only the plain number.
export type SessionRow = {
  readonly short: string
  readonly state: SessionStateSlug
  readonly intent: string | undefined
  readonly createdAtMs: number | undefined
}

const INTENT_MAX_WIDTH = 48

const formatSessionRow = ({
  row,
  now,
  shortWidth,
  stateWidth,
}: {
  readonly row: SessionRow
  readonly now: number
  readonly shortWidth: number
  readonly stateWidth: number
}): string => {
  const age = formatAge(ageMs({ now, sinceMs: row.createdAtMs }))
  const intent = truncate({ text: row.intent ?? "", max: INTENT_MAX_WIDTH })
  return [
    padEndTo({ text: row.short, width: shortWidth }),
    padEndTo({ text: row.state, width: stateWidth }),
    age.padStart(4),
    intent,
  ].join("  ")
}

export const formatSessions = ({
  sessions,
  now,
}: {
  readonly sessions: ReadonlyArray<SessionRow>
  readonly now: number
}): string => {
  if (sessions.length === 0) return "no sessions"
  const shortWidth = Math.max(5, ...sessions.map((s) => s.short.length))
  const stateWidth = Math.max(5, ...sessions.map((s) => s.state.length))
  return sessions.map((row) => formatSessionRow({ row, now, shortWidth, stateWidth })).join("\n")
}

export const formatExplain = (explanation: ExplainSummary): string => {
  const lines = [
    `${explanation.short}  ${explanation.state}${explanation.stale ? " (stale)" : ""}`,
    `source: ${explanation.source}`,
    `updated: ${formatAge(explanation.updatedAtAgeMs)} ago`,
    `last event: ${formatAge(explanation.lastEventAgeMs)} ago`,
  ]
  if (explanation.pidAlive !== undefined) lines.push(`pid alive: ${explanation.pidAlive}`)
  for (const reason of explanation.reasons) lines.push(`- ${reason}`)
  return lines.join("\n")
}

const WAIT_FAILURE_LABEL: Readonly<Record<WaitFailureReason, string>> = {
  timeout: "timed out waiting",
  occupant_changed: "occupant changed",
  removed: "was removed",
  not_found: "was not found",
}

export const formatWaitOutcome = (outcome: WaitOutcomeBody): string =>
  outcome.ok
    ? `${outcome.short} reached "${outcome.state}" after ${outcome.waitedMs}ms`
    : `${outcome.short} ${WAIT_FAILURE_LABEL[outcome.reason]}`

export const formatSent = ({
  short,
  wait,
}: {
  readonly short: string
  readonly wait: WaitOutcomeBody | undefined
}): string =>
  wait === undefined ? `sent to ${short}` : `sent to ${short}; ${formatWaitOutcome(wait)}`

export const formatKeysSent = ({
  short,
  resolved,
  bytes,
  wait,
}: {
  readonly short: string
  readonly resolved: ReadonlyArray<string>
  readonly bytes: number
  readonly wait: WaitOutcomeBody | undefined
}): string => {
  const base = `sent [${resolved.join(", ")}] (${bytes} bytes) to ${short}`
  return wait === undefined ? base : `${base}; ${formatWaitOutcome(wait)}`
}

export const formatStopped = (short: string): string => `stopped ${short}`

export const formatRemoved = (short: string): string => `removed ${short}`

export const formatSpawned = ({
  short,
  intent,
  wait,
}: {
  readonly short: string
  readonly intent: string
  readonly wait: WaitOutcomeBody | undefined
}): string => {
  const base = `spawned ${short} — ${truncate({ text: intent, max: 60 })}`
  return wait === undefined ? base : `${base}; ${formatWaitOutcome(wait)}`
}

const formatFleetError = (e: FleetErrorSummary): string =>
  e.step === undefined ? `[${e.fleet}] ${e.message}` : `[${e.fleet}] step "${e.step}": ${e.message}`

const formatFleetSummary = (f: FleetSummary): string => {
  const header = f.description === undefined ? f.name : `${f.name} — ${f.description}`
  const waveLines = f.waves.map((wave, i) => `  wave ${i + 1}: ${wave.join(", ")}`)
  return [header, ...waveLines].join("\n")
}

export const formatFleets = (response: FleetsResponse): string => {
  const sections = response.fleets.map(formatFleetSummary)
  if (response.errors.length > 0) {
    sections.push(
      [
        `${response.errors.length} recipe error(s):`,
        ...response.errors.map((e) => `  ${formatFleetError(e)}`),
      ].join("\n"),
    )
  }
  if (sections.length === 0) sections.push("no fleet recipes (.pid/fleet.json not found or empty)")
  return sections.join("\n\n")
}

// `pid fleets` doubles as a linter for a hand-edited recipe: a non-empty
// `errors` list means the file is invalid, so exit 2 — the same code already
// used for a usage error, since both mean "fix your input before this does
// anything useful" (see AGENTS.md's exit-code table).
export const exitCodeForFleets = (response: FleetsResponse): ExitCode =>
  response.errors.length > 0 ? 2 : 0

// --- Fleet run formatting -----------------------------------------------------

const formatFleetRunPlanStep = (step: FleetStepSummary): string =>
  step.needs.length === 0
    ? `${step.id} (n=${step.n})`
    : `${step.id} (n=${step.n}, needs: ${step.needs.join(", ")})`

const formatFleetRunWaves = (waves: ReadonlyArray<ReadonlyArray<FleetStepSummary>>): string =>
  waves
    .map((wave, i) => `  wave ${i + 1}: ${wave.map(formatFleetRunPlanStep).join(", ")}`)
    .join("\n")

export const formatFleetDryRun = (result: FleetDryRunResult): string =>
  [
    `dry run — ${result.plan.fleet}: ${result.plan.totalSessions} session(s) across ${result.plan.waves.length} wave(s)`,
    formatFleetRunWaves(result.plan.waves),
  ].join("\n")

export const formatFleetRunStarted = (started: FleetRunStarted): string =>
  [
    `started ${started.runId} — ${started.totalSessions} session(s) across ${started.waves.length} wave(s)`,
    formatFleetRunWaves(started.waves),
  ].join("\n")

const formatFleetRunStepLine = (step: FleetRunStepState): string => {
  const shorts = step.shorts.map((s) => s.short).join(", ")
  const suffix = step.reason === undefined ? "" : ` — ${step.reason}`
  return `  [wave ${step.waveIndex + 1}] ${step.stepId}: ${step.status}${
    shorts.length > 0 ? ` (${shorts})` : ""
  }${suffix}`
}

export const formatFleetRunSummary = (summary: FleetRunSummaryWire): string =>
  [
    `${summary.id} — ${summary.fleet}: ${summary.status}`,
    ...summary.steps.map(formatFleetRunStepLine),
  ].join("\n")

export const formatFleetRuns = (runs: ReadonlyArray<FleetRunSummaryWire>): string => {
  if (runs.length === 0) return "no fleet runs"
  const fleetWidth = Math.max(5, ...runs.map((r) => r.fleet.length))
  return runs
    .map((r) => `${r.id}  ${padEndTo({ text: r.fleet, width: fleetWidth })}  ${r.status}`)
    .join("\n")
}

// --- Filtering -----------------------------------------------------------------

export const filterByState = <T extends { readonly state: SessionStateSlug }>({
  items,
  states,
}: {
  readonly items: ReadonlyArray<T>
  readonly states: ReadonlyArray<SessionStateSlug> | undefined
}): ReadonlyArray<T> =>
  states === undefined || states.length === 0
    ? items
    : items.filter((i) => states.includes(i.state))
