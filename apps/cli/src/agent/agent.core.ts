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

import {
  DEFAULT_OUTPUT_ANCHOR,
  DEFAULT_WAIT_VIA,
  isOutputAnchor,
  isSessionStateSlug,
  isWaitSatisfiedVia,
  isWaitVia,
  OUTPUT_ANCHORS,
  OUTPUT_PATTERN_MAX_CHARS,
  type OutputPattern,
  type SessionStateSlug,
  WAIT_VIA_VALUES,
  type WaitSatisfiedVia,
  type WaitVia,
} from "@pid/shared"
import { Either } from "effect"

export type { OutputPattern, SessionStateSlug, WaitVia }
// --- Session state slugs ----------------------------------------------------
//
// The vocabulary comes from `@pid/shared`, which exists for exactly this: this
// file used to keep a literal copy because `@pid/daemon`'s package.json
// `exports` map only publishes ".", "./server" and "./types", so a deep import
// of a slice-internal module like `sessions.core` does not resolve from
// apps/cli. A `shared/` workspace is a published door — importable here, and
// from a pure core, with no cross-slice debt — so the copy is gone.
export { isSessionStateSlug }

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

// --- Terminal screen-state vocabulary ----------------------------------------
//
// A *terminal* state is not a session state: it is what the daemon read off a
// terminal's screen (`TerminalStateSlug` in
// apps/daemon/src/features/terminal/terminal-state.core.ts), four slugs deep,
// where a session state is the 8-slug roster vocabulary above. Two separate
// unions on purpose — `done`/`needs_input` are roster facts no screen matcher
// can produce, and `unknown` means "nothing matched", not "no idea who this
// is". Mirrored as a literal copy for the same reason the two lists above are
// (apps/cli cannot deep-import a daemon slice-internal module).
const TERMINAL_STATE_SLUGS = ["working", "blocked", "idle", "unknown"] as const
export type TerminalStateSlug = (typeof TERMINAL_STATE_SLUGS)[number]

export const isTerminalStateSlug = (s: string): s is TerminalStateSlug =>
  (TERMINAL_STATE_SLUGS as readonly string[]).includes(s)

// The `scope` half of a `terminalStateKey` — mirrors `TerminalScope` in
// apps/daemon/src/features/terminal/terminal-poll.core.ts. "global" and
// "orchestrator" are single fixed terminals whose scope name doubles as their
// id, so their keys read `global:global` / `orchestrator:orchestrator`.
const TERMINAL_SCOPES = ["global", "orchestrator", "project", "session"] as const
type TerminalScope = (typeof TERMINAL_SCOPES)[number]

const isTerminalScope = (s: string): s is TerminalScope =>
  (TERMINAL_SCOPES as readonly string[]).includes(s)

const TERMINAL_SCOPES_HELP = TERMINAL_SCOPES.join(", ")

// --- Wait vocabulary ----------------------------------------------------------
//
// `--via` and `--until-output`'s `--anchor` validate against the SAME lists the
// daemon parses an untrusted body with (`@pid/shared`'s wait contract), so a
// value this CLI accepts is one the daemon accepts by construction. Rejecting
// here as well is not a second opinion, it is an earlier one: a bad flag costs
// exit 2 instead of a round-trip and a 400.
export const WAIT_VIA_HELP = WAIT_VIA_VALUES.join(", ")

export const OUTPUT_ANCHORS_HELP = OUTPUT_ANCHORS.join(", ")

// --- Command model -----------------------------------------------------------

export type WaitParams = {
  // May be EMPTY when `untilOutput` carries the condition instead — the daemon
  // accepts a wait with either one, and rejects a request with neither.
  readonly until: ReadonlyArray<SessionStateSlug>
  readonly untilOutput: OutputPattern | undefined
  readonly via: WaitVia
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
  readonly untilOutput: OutputPattern | undefined
  readonly via: WaitVia
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

export type RulesCommand = {
  readonly _tag: "Rules"
  readonly json: boolean
  readonly url: string | undefined
}

export type RulesPreviewCommand = {
  readonly _tag: "RulesPreview"
  readonly json: boolean
  readonly url: string | undefined
}

export type TerminalsCommand = {
  readonly _tag: "Terminals"
  // undefined means "the whole map". A key is always the full
  // `<scope>:<id>` shape the daemon publishes, never a bare short — see
  // parseTerminalKey for why the scope is mandatory.
  readonly key: string | undefined
  readonly json: boolean
  readonly url: string | undefined
}

// `pid pane new <scope>:<id>` — the same key shape `pid terminals` prints, so
// the thing you just watched is the thing you open a pane in. `command` is
// everything after a literal `--`, kept as argv: the daemon hands it to zellij
// as argv too, so there is no shell anywhere in the path.
export type PaneNewCommand = {
  readonly _tag: "PaneNew"
  readonly key: string
  readonly cwd: string | undefined
  readonly command: ReadonlyArray<string> | undefined
  readonly json: boolean
  readonly url: string | undefined
}

// `pid pane close <scope>:<id> <paneId>`. The pane id is passed through as
// written — `terminal_3` or the bare `3` a pane's own `ZELLIJ_PANE_ID` carries —
// and normalised daemon-side, which is also where the two spellings have to
// agree for the self-close refusal to work.
export type PaneCloseCommand = {
  readonly _tag: "PaneClose"
  readonly key: string
  readonly paneId: string
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
  | RulesCommand
  | RulesPreviewCommand
  | TerminalsCommand
  | PaneNewCommand
  | PaneCloseCommand
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
const FLAG_VIA: FlagSpec = { name: "via", boolean: false }
const FLAG_UNTIL_OUTPUT: FlagSpec = { name: "until-output", boolean: false }
const FLAG_ANCHOR: FlagSpec = { name: "anchor", boolean: false }

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

const parseSessionsCommand = ({
  rest,
  url,
}: {
  readonly rest: ReadonlyArray<string>
  readonly url: string | undefined
}): Either.Either<Command, UsageError> => {
  const scanned = scanArgv({ command: "sessions", argv: rest, flagSpecs: withJson([FLAG_STATE]) })
  if (Either.isLeft(scanned)) return Either.left(scanned.left)
  const { positionals, flags } = scanned.right
  const extra = rejectExtraPositionals({ command: "sessions", positionals, max: 0 })
  if (Either.isLeft(extra)) return Either.left(extra.left)
  const state = parseOptionalStateFlag({ command: "sessions", flag: "state", flags })
  if (Either.isLeft(state)) return Either.left(state.left)
  return Either.right({ _tag: "Sessions", state: state.right, json: flags.has("json"), url })
}

const parseExplainCommand = ({
  rest,
  url,
}: {
  readonly rest: ReadonlyArray<string>
  readonly url: string | undefined
}): Either.Either<Command, UsageError> => {
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

// `--via` is validated against the shared vocabulary, so this CLI never sends a
// value the daemon would 400 on.
const parseOptionalVia = ({
  command,
  flags,
}: {
  readonly command: string
  readonly flags: ReadonlyMap<string, string>
}): Either.Either<WaitVia, UsageError> => {
  const raw = flags.get("via")
  if (raw === undefined) return Either.right(DEFAULT_WAIT_VIA)
  if (!isWaitVia(raw)) {
    return Either.left(
      usageError(`${command}: --via must be one of ${WAIT_VIA_HELP}, got "${raw}"`),
    )
  }
  return Either.right(raw)
}

// The anchor half of `--until-output`. Split out so parseOptionalUntilOutput
// itself stays a short chain of guard clauses.
const parseAnchorFlag = ({
  command,
  raw,
}: {
  readonly command: string
  readonly raw: string | undefined
}): Either.Either<OutputPattern["anchor"], UsageError> => {
  if (raw === undefined) return Either.right(DEFAULT_OUTPUT_ANCHOR)
  if (!isOutputAnchor(raw)) {
    return Either.left(
      usageError(`${command}: --anchor must be one of ${OUTPUT_ANCHORS_HELP}, got "${raw}"`),
    )
  }
  return Either.right(raw)
}

// The text half. Both bounds are the daemon's own (`@pid/shared`), quoted back
// in the message so a caller sees the real cap rather than a rounded number.
const parsePatternText = ({
  command,
  raw,
}: {
  readonly command: string
  readonly raw: string
}): Either.Either<string, UsageError> => {
  if (raw.length === 0) {
    return Either.left(usageError(`${command}: --until-output must be a non-empty string`))
  }
  if (raw.length > OUTPUT_PATTERN_MAX_CHARS) {
    return Either.left(
      usageError(
        `${command}: --until-output is capped at ${OUTPUT_PATTERN_MAX_CHARS} characters, got ${raw.length}`,
      ),
    )
  }
  return Either.right(raw)
}

// An anchor with nothing to anchor would be dropped silently on the wire, which
// reads as "the wait is broken" rather than "you forgot the pattern".
const rejectDanglingAnchor = ({
  command,
  raw,
  anchorRaw,
}: {
  readonly command: string
  readonly raw: string | undefined
  readonly anchorRaw: string | undefined
}): UsageError | undefined =>
  raw === undefined && anchorRaw !== undefined
    ? usageError(`${command}: --anchor only applies with --until-output`)
    : undefined

const parseOptionalUntilOutput = ({
  command,
  flags,
}: {
  readonly command: string
  readonly flags: ReadonlyMap<string, string>
}): Either.Either<OutputPattern | undefined, UsageError> => {
  const raw = flags.get("until-output")
  const anchorRaw = flags.get("anchor")
  const dangling = rejectDanglingAnchor({ command, raw, anchorRaw })
  if (dangling !== undefined) return Either.left(dangling)
  if (raw === undefined) return Either.right(undefined)
  const combined = Either.all({
    text: parsePatternText({ command, raw }),
    anchor: parseAnchorFlag({ command, raw: anchorRaw }),
  })
  return Either.isLeft(combined) ? Either.left(combined.left) : Either.right(combined.right)
}

// `--until` is optional only because `--until-output` can carry the condition
// instead; a wait with neither has nothing to wait for. Mirrors the daemon's own
// "a wait needs until or untilOutput" 400 as a usage error, before the request.
// Absent `--until` resolves to an EMPTY list, which buildWaitRequestBody then
// omits from the body — the daemon rejects `until: []`.
const requireSomeWaitCondition = ({
  until,
  untilOutput,
}: {
  readonly until: ReadonlyArray<SessionStateSlug> | undefined
  readonly untilOutput: OutputPattern | undefined
}): Either.Either<ReadonlyArray<SessionStateSlug>, UsageError> =>
  until === undefined && untilOutput === undefined
    ? Either.left(usageError("wait: --until or --until-output is required"))
    : Either.right(until ?? [])

const parseWaitConditions = ({
  flags,
}: {
  readonly flags: ReadonlyMap<string, string>
}): Either.Either<
  {
    readonly until: ReadonlyArray<SessionStateSlug>
    readonly untilOutput: OutputPattern | undefined
  },
  UsageError
> => {
  const combined = Either.all({
    until: parseOptionalStateFlag({ command: "wait", flag: "until", flags }),
    untilOutput: parseOptionalUntilOutput({ command: "wait", flags }),
  })
  if (Either.isLeft(combined)) return Either.left(combined.left)
  const { until, untilOutput } = combined.right
  const resolved = requireSomeWaitCondition({ until, untilOutput })
  if (Either.isLeft(resolved)) return Either.left(resolved.left)
  return Either.right({ until: resolved.right, untilOutput })
}

const parseWaitCommand = ({
  rest,
  url,
}: {
  readonly rest: ReadonlyArray<string>
  readonly url: string | undefined
}): Either.Either<Command, UsageError> => {
  const scanned = scanArgv({
    command: "wait",
    argv: rest,
    flagSpecs: withJson([FLAG_UNTIL, FLAG_UNTIL_OUTPUT, FLAG_ANCHOR, FLAG_VIA, FLAG_TIMEOUT]),
  })
  if (Either.isLeft(scanned)) return Either.left(scanned.left)
  const { positionals, flags } = scanned.right
  const combined = Either.all({
    short: requireSingleShort({ command: "wait", positionals }),
    conditions: parseWaitConditions({ flags }),
    via: parseOptionalVia({ command: "wait", flags }),
    timeoutMs: parseOptionalTimeout({ command: "wait", flags }),
  })
  if (Either.isLeft(combined)) return Either.left(combined.left)
  const { short, conditions, via, timeoutMs } = combined.right
  return Either.right({
    _tag: "Wait",
    short,
    until: conditions.until,
    untilOutput: conditions.untilOutput,
    via,
    timeoutMs,
    json: flags.has("json"),
    url,
  })
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
  // `send`/`keys`/`spawn` take slugs only: their `--wait` is a convenience on
  // top of the action, so it stays the supervisor wait it has always been.
  // `pid wait` is where `--via` / `--until-output` live.
  return Either.isLeft(combined)
    ? Either.left(combined.left)
    : Either.right({ ...combined.right, untilOutput: undefined, via: DEFAULT_WAIT_VIA })
}

const parseSendCommand = ({
  rest,
  url,
}: {
  readonly rest: ReadonlyArray<string>
  readonly url: string | undefined
}): Either.Either<Command, UsageError> => {
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

const parseKeysCommand = ({
  rest,
  url,
}: {
  readonly rest: ReadonlyArray<string>
  readonly url: string | undefined
}): Either.Either<Command, UsageError> => {
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

const parseSpawnCommand = ({
  rest,
  url,
}: {
  readonly rest: ReadonlyArray<string>
  readonly url: string | undefined
}): Either.Either<Command, UsageError> => {
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

const parseFleetsCommand = ({
  rest,
  url,
}: {
  readonly rest: ReadonlyArray<string>
  readonly url: string | undefined
}): Either.Either<Command, UsageError> => {
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
const parseFleetRunCommand = ({
  rest,
  url,
}: {
  readonly rest: ReadonlyArray<string>
  readonly url: string | undefined
}): Either.Either<Command, UsageError> => {
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

const parseFleetRunsCommand = ({
  rest,
  url,
}: {
  readonly rest: ReadonlyArray<string>
  readonly url: string | undefined
}): Either.Either<Command, UsageError> => {
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
const parseFleetCommand = ({
  rest,
  url,
}: {
  readonly rest: ReadonlyArray<string>
  readonly url: string | undefined
}): Either.Either<Command, UsageError> => {
  const [sub, ...subRest] = rest
  if (sub === "run") return parseFleetRunCommand({ rest: subRest, url })
  if (sub === "runs") return parseFleetRunsCommand({ rest: subRest, url })
  return Either.left(
    usageError(
      `fleet: unknown subcommand${sub === undefined ? " (expected run|runs)" : `: ${sub}`}`,
    ),
  )
}

const parseRulesListCommand = ({
  rest,
  url,
}: {
  readonly rest: ReadonlyArray<string>
  readonly url: string | undefined
}): Either.Either<Command, UsageError> => {
  const scanned = scanArgv({ command: "rules", argv: rest, flagSpecs: withJson([]) })
  if (Either.isLeft(scanned)) return Either.left(scanned.left)
  const extra = rejectExtraPositionals({
    command: "rules",
    positionals: scanned.right.positionals,
    max: 0,
  })
  if (Either.isLeft(extra)) return Either.left(extra.left)
  return Either.right({ _tag: "Rules", json: scanned.right.flags.has("json"), url })
}

const parseRulesPreviewCommand = ({
  rest,
  url,
}: {
  readonly rest: ReadonlyArray<string>
  readonly url: string | undefined
}): Either.Either<Command, UsageError> => {
  const scanned = scanArgv({ command: "rules preview", argv: rest, flagSpecs: withJson([]) })
  if (Either.isLeft(scanned)) return Either.left(scanned.left)
  const extra = rejectExtraPositionals({
    command: "rules preview",
    positionals: scanned.right.positionals,
    max: 0,
  })
  if (Either.isLeft(extra)) return Either.left(extra.left)
  return Either.right({ _tag: "RulesPreview", json: scanned.right.flags.has("json"), url })
}

// `pid rules preview` is the only rules subcommand — dispatched by hand the
// same way `pid fleet <run|runs>` is above; anything else (including no
// subcommand at all) is the plain listing.
const parseRulesCommand = ({
  rest,
  url,
}: {
  readonly rest: ReadonlyArray<string>
  readonly url: string | undefined
}): Either.Either<Command, UsageError> => {
  const [sub, ...subRest] = rest
  return sub === "preview"
    ? parseRulesPreviewCommand({ rest: subRest, url })
    : parseRulesListCommand({ rest, url })
}

// `<scope>:<id>` split on the FIRST colon only — an id may itself contain one
// (a project id is a directory name), so only the scope half is delimited.
const splitTerminalKey = (
  raw: string,
): { readonly scope: string; readonly id: string } | undefined => {
  const idx = raw.indexOf(":")
  if (idx <= 0) return undefined
  const id = raw.slice(idx + 1)
  return id.length === 0 ? undefined : { scope: raw.slice(0, idx), id }
}

// The scope is mandatory, not inferred: session shorts, project ids and the
// two fixed terminal names share one key namespace, so a bare `ab12` could
// name either a session or a project and the CLI would have to guess. A usage
// error (exit 2) here is strictly better than a confident answer about the
// wrong terminal — and better than a `not found` (6) that reads as "no such
// session" when the real problem is a malformed argument.
const parseTerminalKey = (raw: string): Either.Either<string, UsageError> => {
  const parts = splitTerminalKey(raw)
  if (parts === undefined) {
    return Either.left(
      usageError(
        `terminals: "${raw}" is not a terminal key — expected <scope>:<id>, e.g. session:ab12`,
      ),
    )
  }
  if (!isTerminalScope(parts.scope)) {
    return Either.left(
      usageError(
        `terminals: unknown scope "${parts.scope}" — expected one of: ${TERMINAL_SCOPES_HELP}`,
      ),
    )
  }
  return Either.right(raw)
}

const parseOptionalTerminalKey = (
  positionals: ReadonlyArray<string>,
): Either.Either<string | undefined, UsageError> => {
  const raw = positionals[0]
  return raw === undefined ? Either.right(undefined) : parseTerminalKey(raw)
}

const parseTerminalsCommand = ({
  rest,
  url,
}: {
  readonly rest: ReadonlyArray<string>
  readonly url: string | undefined
}): Either.Either<Command, UsageError> => {
  const scanned = scanArgv({ command: "terminals", argv: rest, flagSpecs: withJson([]) })
  if (Either.isLeft(scanned)) return Either.left(scanned.left)
  const { positionals, flags } = scanned.right
  const combined = Either.all({
    extra: rejectExtraPositionals({ command: "terminals", positionals, max: 1 }),
    key: parseOptionalTerminalKey(positionals),
  })
  if (Either.isLeft(combined)) return Either.left(combined.left)
  return Either.right({
    _tag: "Terminals",
    key: combined.right.key,
    json: flags.has("json"),
    url,
  })
}

// --- pane new / pane close ---------------------------------------------------

// Everything after the FIRST literal `--` is the pane's command, flags and all.
// Without this split, `pid pane new session:ab12 -- bun test --json` would have
// its `--json` stolen by the CLI instead of reaching the program being run.
const splitAtDoubleDash = (
  argv: ReadonlyArray<string>,
): {
  readonly head: ReadonlyArray<string>
  readonly command: ReadonlyArray<string> | undefined
} => {
  const idx = argv.indexOf("--")
  if (idx === -1) return { head: argv, command: undefined }
  const command = argv.slice(idx + 1)
  return { head: argv.slice(0, idx), command: command.length === 0 ? undefined : command }
}

// The pane commands validate their target exactly the way `pid terminals` does —
// same key shape, same refusal to guess a scope — so the message is reused with
// only the command name swapped rather than written twice.
const paneKeyOf = ({
  command,
  raw,
}: {
  readonly command: string
  readonly raw: string
}): Either.Either<string, UsageError> =>
  Either.mapLeft(parseTerminalKey(raw), (err) =>
    usageError(err.message.replace(/^terminals/, command)),
  )

// Shared by both pane subcommands: the first positional is the terminal key, and
// `max` is however many positionals that subcommand allows in total.
const requirePaneTarget = ({
  command,
  positionals,
  max,
}: {
  readonly command: string
  readonly positionals: ReadonlyArray<string>
  readonly max: number
}): Either.Either<string, UsageError> => {
  const raw = positionals[0]
  if (raw === undefined) {
    return Either.left(usageError(`${command}: requires a <scope>:<id> argument`))
  }
  const extra = rejectExtraPositionals({ command, positionals, max })
  return Either.isLeft(extra) ? Either.left(extra.left) : paneKeyOf({ command, raw })
}

const parsePaneNewCommand = ({
  rest,
  url,
}: {
  readonly rest: ReadonlyArray<string>
  readonly url: string | undefined
}): Either.Either<Command, UsageError> => {
  const { head, command } = splitAtDoubleDash(rest)
  const scanned = scanArgv({ command: "pane new", argv: head, flagSpecs: withJson([FLAG_CWD]) })
  if (Either.isLeft(scanned)) return Either.left(scanned.left)
  const { positionals, flags } = scanned.right
  const target = requirePaneTarget({ command: "pane new", positionals, max: 1 })
  if (Either.isLeft(target)) return Either.left(target.left)
  return Either.right({
    _tag: "PaneNew",
    key: target.right,
    cwd: flags.get("cwd"),
    command,
    json: flags.has("json"),
    url,
  })
}

const parsePaneCloseCommand = ({
  rest,
  url,
}: {
  readonly rest: ReadonlyArray<string>
  readonly url: string | undefined
}): Either.Either<Command, UsageError> => {
  const scanned = scanArgv({ command: "pane close", argv: rest, flagSpecs: withJson([]) })
  if (Either.isLeft(scanned)) return Either.left(scanned.left)
  const { positionals, flags } = scanned.right
  // Checked before the key so a lone `pane close session:ab12` says what is
  // actually missing rather than complaining about the argument that is present.
  const paneId = positionals[1]
  if (paneId === undefined) {
    return Either.left(usageError("pane close: requires a <scope>:<id> and a pane id"))
  }
  const target = requirePaneTarget({ command: "pane close", positionals, max: 2 })
  if (Either.isLeft(target)) return Either.left(target.left)
  return Either.right({
    _tag: "PaneClose",
    key: target.right,
    paneId,
    json: flags.has("json"),
    url,
  })
}

const parsePaneCommand = ({
  rest,
  url,
}: {
  readonly rest: ReadonlyArray<string>
  readonly url: string | undefined
}): Either.Either<Command, UsageError> => {
  const [sub, ...subRest] = rest
  if (sub === "new") return parsePaneNewCommand({ rest: subRest, url })
  if (sub === "close") return parsePaneCloseCommand({ rest: subRest, url })
  return Either.left(
    usageError(
      `pane: unknown subcommand${sub === undefined ? "" : `: ${sub}`} (expected new|close)`,
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
    (input: {
      readonly rest: ReadonlyArray<string>
      readonly url: string | undefined
    }) => Either.Either<Command, UsageError>
  >
> = {
  sessions: parseSessionsCommand,
  explain: parseExplainCommand,
  wait: parseWaitCommand,
  send: parseSendCommand,
  keys: parseKeysCommand,
  spawn: parseSpawnCommand,
  stop: ({ rest, url }) => parseShortOnlyCommand({ tag: "Stop", command: "stop", rest, url }),
  rm: ({ rest, url }) => parseShortOnlyCommand({ tag: "Rm", command: "rm", rest, url }),
  fleets: parseFleetsCommand,
  fleet: parseFleetCommand,
  rules: parseRulesCommand,
  terminals: parseTerminalsCommand,
  pane: parsePaneCommand,
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
  return parser
    ? parser({ rest: subRest, url })
    : Either.left(usageError(`unknown command: ${sub}`))
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
//
// 8 is `screen_polling_disabled`, and it exists because every alternative
// misleads an agent into the wrong retry:
//   - 3 (timeout) would say "the pattern has not appeared yet", so a caller
//     loops forever on a daemon that can never watch a screen. This is the
//     specific confusion the code is here to prevent.
//   - 2 (usage) would say "fix your command line", but the request is
//     well-formed — the daemon itself answers 409, not 400, precisely because
//     the same request is valid on a daemon with the poller armed.
//   - 1 (transport/unparseable) would say "something went wrong, unclear
//     what", when in fact the daemon stated the problem plainly and this CLI
//     understood it.
// 8 means "this daemon cannot serve this request as configured": deterministic,
// so the correct response is to stop and report rather than retry.
export type ExitCode = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8

export const exitCodeForUsage = (): ExitCode => 2

export type WaitFailureReason =
  | "timeout"
  | "occupant_changed"
  | "removed"
  | "not_found"
  | "screen_polling_disabled"

// Two shapes of success, distinguished by which field is present (the daemon's
// own convention): a state was reached, or a pattern appeared on screen. A
// pattern match has no state to report — nothing about the supervisor's view
// changed — so `matched` is the discriminator, as it is on the wire.
export type WaitOutcomeBody =
  | {
      readonly ok: true
      readonly short: string
      readonly state: SessionStateSlug
      // Which observation settled it. Optional because a daemon that predates
      // the field simply omits it, and "satisfied" is still the whole answer.
      readonly via?: WaitSatisfiedVia
      readonly waitedMs: number
    }
  | {
      readonly ok: true
      readonly short: string
      readonly matched: string
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
  screen_polling_disabled: 8,
}

export const exitCodeForWaitBody = (body: WaitOutcomeBody): ExitCode =>
  body.ok ? 0 : WAIT_FAILURE_EXIT[body.reason]

// `POST /:id/wait` answers 409 for a condition no other command produces: the
// request is fine, this daemon's poller is off. A table rather than a chain so
// adding a status later is one row (see exitCodeForFleetRunPostStatus in
// main.ts for the same shape on the fleet-run POST).
const WAIT_POST_STATUS_EXIT: Readonly<Record<number, ExitCode>> = {
  404: 6,
  409: 8,
}

export const exitCodeForWaitPostStatus = (status: number): ExitCode =>
  WAIT_POST_STATUS_EXIT[status] ?? 1

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
  // A disabled poller out-ranks a transport failure on purpose: it is the one
  // outcome here that retrying cannot change, so when several spawn+wait
  // attempts disagree it is the finding the caller has to act on. Still below a
  // usage error, which short-circuits before any request is made.
  8: 5.5,
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
  "screen_polling_disabled",
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

// `via` is absent on a daemon that predates it, and strictly one of the two
// observations otherwise — "either" is a request, never an answer, so a daemon
// echoing it back is drift worth failing on rather than displaying.
const parseOptionalSatisfiedVia = (
  value: unknown,
): Either.Either<WaitSatisfiedVia | undefined, ParseError> => {
  if (value === undefined) return Either.right(undefined)
  return isWaitSatisfiedVia(value)
    ? Either.right(value)
    : Either.left(parseError(`wait response has an unrecognized via: ${JSON.stringify(value)}`))
}

const parseSatisfiedWait = ({
  obj,
  short,
}: {
  readonly obj: Record<string, unknown>
  readonly short: string
}): Either.Either<WaitOutcomeBody, ParseError> => {
  const combined = Either.all({
    state: requireStateSlugField({
      value: obj.state,
      message: `wait response has an unrecognized state: ${JSON.stringify(obj.state)}`,
    }),
    via: parseOptionalSatisfiedVia(obj.via),
    waitedMs: requireNumberField({
      value: obj.waitedMs,
      message: "wait response is missing waitedMs",
    }),
  })
  return Either.isLeft(combined)
    ? Either.left(combined.left)
    : Either.right({ ok: true, short, ...combined.right })
}

// The other success: an `untilOutput` pattern appeared. Carries the line it
// appeared on and no state at all.
const parseOutputMatchedWait = ({
  obj,
  short,
}: {
  readonly obj: Record<string, unknown>
  readonly short: string
}): Either.Either<WaitOutcomeBody, ParseError> => {
  const combined = Either.all({
    matched: requireStringField({
      value: obj.matched,
      message: "wait response is missing matched",
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

const parseFailedWait = ({
  obj,
  short,
}: {
  readonly obj: Record<string, unknown>
  readonly short: string
}): Either.Either<WaitOutcomeBody, ParseError> => {
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

// A satisfied wait and a pattern match are both `ok: true`; `matched` is what
// tells them apart, so it is checked before the state shape.
const parseSucceededWait = ({
  obj,
  short,
}: {
  readonly obj: Record<string, unknown>
  readonly short: string
}): Either.Either<WaitOutcomeBody, ParseError> =>
  obj.matched === undefined
    ? parseSatisfiedWait({ obj, short })
    : parseOutputMatchedWait({ obj, short })

export const parseWaitOutcomeBody = (raw: unknown): Either.Either<WaitOutcomeBody, ParseError> => {
  const base = requireShortFrom(raw)
  if (Either.isLeft(base)) return Either.left(base.left)
  const { obj, short } = base.right
  if (obj.ok === true) return parseSucceededWait({ obj, short })
  if (obj.ok === false) return parseFailedWait({ obj, short })
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

// What the pane itself last showed. `state` is a plain string, not a
// TerminalStateSlug: the daemon types this field as `string` so a classifier
// slug newer than this CLI is displayed rather than rejected.
export type ExplainTerminalFacts = {
  readonly state: string
  readonly matcher: string | undefined
  readonly evidence: string | undefined
  readonly ageMs: number | undefined
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
  // Absent when nothing has classified this session's pane.
  readonly terminal: ExplainTerminalFacts | undefined
  // Whether that reading contradicts `state` — the daemon's own verdict, not
  // recomputed here: it owns the table of which screen state agrees with which
  // session state, and a second implementation would be a second answer.
  readonly screenDisagrees: boolean
  readonly reasons: ReadonlyArray<string>
}

// Absent is a real answer ("no screen evidence"), so it decodes to `undefined`
// rather than failing — this CLI is routinely pointed at a daemon that has been
// running since before these two fields existed. Present but malformed is drift,
// and fails loudly.
const parseExplainTerminal = (
  value: unknown,
): Either.Either<ExplainTerminalFacts | undefined, ParseError> => {
  if (value === undefined) return Either.right(undefined)
  if (!isPlainObject(value)) {
    return Either.left(parseError("explain response terminal must be an object"))
  }
  const state = requireNonEmptyStringField({
    value: value.state,
    message: "explain response terminal is missing state",
  })
  if (Either.isLeft(state)) return Either.left(state.left)
  return Either.right({
    state: state.right,
    matcher: optionalString(value.matcher),
    evidence: optionalString(value.evidence),
    ageMs: optionalNumber(value.ageMs),
  })
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
    terminal: parseExplainTerminal(raw.terminal),
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
    // A daemon that never sends this field never disagrees, which is exactly
    // what it meant before the field existed.
    screenDisagrees: optionalBoolean(raw.screenDisagrees) ?? false,
  })
}

// --- Terminal screen states (GET /terminal/states) ---------------------------
//
// The daemon answers with a MAP keyed by `<scope>:<id>` (`terminalStateKey` in
// terminal-state.core.ts), not an array, so the key is the identity and is
// carried onto each entry here — `scope`/`id` are also present in the record
// but are redundant with it.

export type TerminalStateEntry = {
  readonly key: string
  readonly state: TerminalStateSlug
  // Which MATCHERS row fired, and the line it matched — both absent for an
  // `unknown` classification (nothing matched, so there is nothing to quote).
  readonly matcher: string | undefined
  readonly evidence: string | undefined
  // Raw ISO string as the daemon stamped it; the core does not read a clock,
  // so turning it into an age is the shell's job (see TerminalRow below, the
  // same split SessionListEntry/SessionRow uses for `createdAt`).
  readonly at: string | undefined
}

// A slug this CLI doesn't know degrades to `unknown` rather than failing the
// whole map — same policy as parseSessionListItem above, and `unknown` is
// already this vocabulary's own "nothing recognised" value.
const normalizeTerminalState = (state: unknown): TerminalStateSlug =>
  typeof state === "string" && isTerminalStateSlug(state) ? state : "unknown"

const parseTerminalStateItem = ({
  key,
  value,
}: {
  readonly key: string
  readonly value: unknown
}): TerminalStateEntry | undefined =>
  isPlainObject(value)
    ? {
        key,
        state: normalizeTerminalState(value.state),
        matcher: optionalString(value.matcher),
        evidence: optionalString(value.evidence),
        at: optionalString(value.at),
      }
    : undefined

export const parseTerminalStatesResponse = (
  raw: unknown,
): Either.Either<ReadonlyArray<TerminalStateEntry>, ParseError> => {
  if (!isPlainObject(raw)) return Either.left(parseError("terminals response must be an object"))
  const entries = Object.entries(raw)
    .map(([key, value]) => parseTerminalStateItem({ key, value }))
    .filter((e): e is TerminalStateEntry => e !== undefined)
  return Either.right(entries)
}

export const filterTerminalsByKey = ({
  terminals,
  key,
}: {
  readonly terminals: ReadonlyArray<TerminalStateEntry>
  readonly key: string | undefined
}): ReadonlyArray<TerminalStateEntry> =>
  key === undefined ? terminals : terminals.filter((t) => t.key === key)

// A key absent from the map exits 6, the same "not found" an explicit 404
// carries. It is deliberately NOT reported as `state: "unknown"`: `unknown` is
// a real classification — the daemon looked at that screen and no matcher
// fired — whereas an absent key means nobody has looked at all (no WS bridge
// has ever attached, the poller is disabled, or it has not reached that
// terminal yet), which is also what a typo'd or dead short produces. Folding
// the two together would make `pid terminals session:typo` answer confidently
// about a session that does not exist, and would strip an orchestrating agent
// of the one distinction it needs to decide between "retry, classification is
// pending" and "this short is wrong". Asking for the whole map is never a
// not-found: an empty map is a legitimate answer (exit 0).
export const exitCodeForTerminalLookup = ({
  key,
  matched,
}: {
  readonly key: string | undefined
  readonly matched: number
}): ExitCode => (key !== undefined && matched === 0 ? 6 : 0)

// --- Panes (POST /terminal/panes, POST /terminal/panes/close) ----------------
//
// The daemon's only write surface into zellij. Everything the CLI contributes
// here is shaping: split the `<scope>:<id>` key the way the daemon expects, keep
// the pane's command as argv, and turn a refusal into an exit code a shell can
// branch on.

// The `key` is validated by parseTerminalKey before it gets here, so the split
// cannot fail — and it splits on the FIRST colon only, because a project id may
// contain one.
const keyParts = (key: string): { readonly scope: string; readonly id: string } => {
  const idx = key.indexOf(":")
  return { scope: key.slice(0, idx), id: key.slice(idx + 1) }
}

export const buildPaneNewBody = ({
  key,
  cwd,
  command,
}: {
  readonly key: string
  readonly cwd: string | undefined
  readonly command: ReadonlyArray<string> | undefined
}): Record<string, unknown> => ({
  ...keyParts(key),
  // Omitted rather than sent as null: the daemon reads "no cwd" as "inherit the
  // session's", and an explicit null would be a bad request.
  ...(cwd === undefined ? {} : { cwd }),
  ...(command === undefined ? {} : { command }),
})

export const buildPaneCloseBody = ({
  key,
  paneId,
  callerPaneId,
  callerSessionName,
}: {
  readonly key: string
  readonly paneId: string
  // The caller's own pane and session, read from the environment by the shell.
  // Sent so the daemon can refuse a self-close; absent outside a zellij pane.
  readonly callerPaneId: string | undefined
  readonly callerSessionName: string | undefined
}): Record<string, unknown> => ({
  ...keyParts(key),
  paneId,
  ...(callerPaneId === undefined ? {} : { callerPaneId }),
  ...(callerSessionName === undefined ? {} : { callerSessionName }),
})

// 404 is "this daemon has no such terminal" — the same not-found every other
// command reports as 6. A 409 is a REFUSAL: the request was understood, the
// answer is no, and no retry will change it, so it is the caller's mistake to
// fix (2) rather than a transport failure (1) or a timeout (3). 400 is the same
// class of caller error. Anything else, including the 502 a failed `zellij
// action` produces, is 1: the daemon could not carry the request out and the
// caller does not know what state zellij is in.
const PANE_STATUS_EXIT: Readonly<Record<number, ExitCode>> = {
  200: 0,
  400: 2,
  404: 6,
  409: 2,
}

export const exitCodeForPaneStatus = (status: number): ExitCode => PANE_STATUS_EXIT[status] ?? 1

export type PaneResponse = {
  readonly paneId: string
  readonly paneName: string | undefined
  readonly sessionName: string | undefined
  // Present on a create: the key this pane's screen classification appears under
  // in `pid terminals`.
  readonly key: string | undefined
  // Present on a close: whether THIS call closed the pane, or it had already
  // gone. Both are the goal state; only one of them did anything.
  readonly closed: boolean | undefined
}

export const parsePaneResponse = (raw: unknown): Either.Either<PaneResponse, ParseError> => {
  if (!isPlainObject(raw)) return Either.left(parseError("pane response must be an object"))
  const paneId = optionalString(raw.paneId)
  if (paneId === undefined) return Either.left(parseError("pane response has no paneId"))
  return Either.right({
    paneId,
    paneName: optionalString(raw.paneName),
    sessionName: optionalString(raw.sessionName),
    key: optionalString(raw.key),
    closed: typeof raw.closed === "boolean" ? raw.closed : undefined,
  })
}

// One line, and every part of it is something the caller needs next: the pane id
// to close it with, the key to watch its screen under, the minted name so the
// pane is findable in zellij's own tab bar, and the session it landed in.
export const formatPaneCreated = (input: {
  readonly scope: string
  readonly id: string
  readonly paneId: string
  readonly paneName: string | undefined
  readonly sessionName: string | undefined
  readonly key: string | undefined
}): string =>
  [
    `pane ${input.paneId} opened in ${input.scope}:${input.id}`,
    input.sessionName === undefined ? undefined : `(zellij session ${input.sessionName})`,
    input.paneName === undefined ? undefined : `named ${input.paneName}`,
    input.key === undefined ? undefined : `— screen at ${input.key}`,
  ]
    .filter((part): part is string => part !== undefined)
    .join(" ")

export const formatPaneClosed = (input: {
  readonly paneId: string
  readonly closed: boolean | undefined
}): string =>
  input.closed === false ? `pane ${input.paneId} was already gone` : `pane ${input.paneId} closed`

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

// --- State-change rules (GET /rules, POST /rules/preview) --------------------
//
// `--json` always prints the daemon's response verbatim (see runRules/
// runRulesPreview in main.ts), so only enough of the shape is parsed here to
// render a useful human summary: a rule's name/enabled (not its full
// when/do), and a firing-log entry's tag/rule/short/at (not its full action/
// suppression-reason payload).

export type RuleErrorSummary = {
  readonly rule: string
  readonly message: string
}

const parseRuleErrorSummary = (raw: unknown): Either.Either<RuleErrorSummary, ParseError> => {
  if (!isPlainObject(raw)) return Either.left(parseError("rule error must be an object"))
  return Either.all({
    rule: requireNonEmptyStringField({ value: raw.rule, message: "rule error is missing rule" }),
    message: requireNonEmptyStringField({
      value: raw.message,
      message: "rule error is missing message",
    }),
  })
}

const parseRuleErrors = (
  raw: unknown,
): Either.Either<ReadonlyArray<RuleErrorSummary>, ParseError> =>
  Array.isArray(raw)
    ? Either.all(raw.map(parseRuleErrorSummary))
    : Either.left(parseError("rules response is missing errors"))

export type RuleSummary = {
  readonly name: string
  readonly enabled: boolean
}

const parseRuleSummary = (raw: unknown): Either.Either<RuleSummary, ParseError> => {
  if (!isPlainObject(raw)) return Either.left(parseError("rule must be an object"))
  return Either.all({
    name: requireNonEmptyStringField({ value: raw.name, message: "rule is missing name" }),
    enabled: requireBooleanField({ value: raw.enabled, message: "rule is missing enabled" }),
  })
}

export type RuleFiringLogEntry = {
  readonly tag: string
  readonly rule: string
  readonly short: string
  readonly at: number
}

const parseRuleFiringLogEntry = (raw: unknown): Either.Either<RuleFiringLogEntry, ParseError> => {
  if (!isPlainObject(raw)) return Either.left(parseError("log entry must be an object"))
  const combined = Either.all({
    tag: requireNonEmptyStringField({ value: raw._tag, message: "log entry is missing _tag" }),
    rule: requireNonEmptyStringField({ value: raw.rule, message: "log entry is missing rule" }),
    short: requireNonEmptyStringField({ value: raw.short, message: "log entry is missing short" }),
    at: requireNumberField({ value: raw.at, message: "log entry is missing at" }),
  })
  return combined
}

export type RulesStatusSummary = {
  readonly enabled: boolean
  readonly paused: boolean
  readonly errors: ReadonlyArray<RuleErrorSummary>
  readonly rules: ReadonlyArray<RuleSummary>
  readonly log: ReadonlyArray<RuleFiringLogEntry>
}

export const parseRulesStatusResponse = (
  raw: unknown,
): Either.Either<RulesStatusSummary, ParseError> => {
  if (!isPlainObject(raw)) return Either.left(parseError("rules response must be an object"))
  return Either.all({
    enabled: requireBooleanField({
      value: raw.enabled,
      message: "rules response is missing enabled",
    }),
    paused: requireBooleanField({ value: raw.paused, message: "rules response is missing paused" }),
    errors: parseRuleErrors(raw.errors),
    rules: Array.isArray(raw.rules)
      ? Either.all(raw.rules.map(parseRuleSummary))
      : Either.left(parseError("rules response is missing rules")),
    log: Array.isArray(raw.log)
      ? Either.all(raw.log.map(parseRuleFiringLogEntry))
      : Either.left(parseError("rules response is missing log")),
  })
}

export type RulesPreviewOutcomeSummary = {
  readonly tag: "Fired" | "Suppressed"
  readonly rule: string
  readonly short: string
}

const requireOutcomeTag = (value: unknown): Either.Either<"Fired" | "Suppressed", ParseError> =>
  value === "Fired" || value === "Suppressed"
    ? Either.right(value)
    : Either.left(parseError(`preview outcome has an unrecognized _tag: ${JSON.stringify(value)}`))

const parseRulesPreviewOutcome = (
  raw: unknown,
): Either.Either<RulesPreviewOutcomeSummary, ParseError> => {
  if (!isPlainObject(raw)) return Either.left(parseError("preview outcome must be an object"))
  return Either.all({
    tag: requireOutcomeTag(raw._tag),
    rule: requireNonEmptyStringField({
      value: raw.rule,
      message: "preview outcome is missing rule",
    }),
    short: requireNonEmptyStringField({
      value: raw.short,
      message: "preview outcome is missing short",
    }),
  })
}

export type RulesPreviewSummary = {
  readonly errors: ReadonlyArray<RuleErrorSummary>
  readonly outcomes: ReadonlyArray<RulesPreviewOutcomeSummary>
}

export const parseRulesPreviewResponse = (
  raw: unknown,
): Either.Either<RulesPreviewSummary, ParseError> => {
  if (!isPlainObject(raw))
    return Either.left(parseError("rules preview response must be an object"))
  return Either.all({
    errors: parseRuleErrors(raw.errors),
    outcomes: Array.isArray(raw.outcomes)
      ? Either.all(raw.outcomes.map(parseRulesPreviewOutcome))
      : Either.left(parseError("rules preview response is missing outcomes")),
  })
}

// `pid rules` doubles as a linter for a hand-edited rules.json, same as `pid
// fleets` — a non-empty `errors` list means the file is invalid, so exit 2
// (see AGENTS.md's exit-code table: 2 already covers "an invalid recipe
// file", broadened here to cover an invalid rules file too — no new outcome
// exists that 2 doesn't already mean).
export const exitCodeForRulesErrors = (errors: ReadonlyArray<RuleErrorSummary>): ExitCode =>
  errors.length > 0 ? 2 : 0

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

const requireStepWaveArrayField = ({
  value,
  message,
}: {
  readonly value: unknown
  readonly message: string
}): Either.Either<ReadonlyArray<ReadonlyArray<FleetStepSummary>>, ParseError> =>
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
    waves: requireStepWaveArrayField({
      value: raw.waves,
      message: "fleet run plan has invalid waves",
    }),
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
    waves: requireStepWaveArrayField({
      value: raw.waves,
      message: "fleet run response has invalid waves",
    }),
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

const requireFleetRunShortsField = ({
  value,
  message,
}: {
  readonly value: unknown
  readonly message: string
}): Either.Either<ReadonlyArray<FleetRunShortWire>, ParseError> =>
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
    shorts: requireFleetRunShortsField({
      value: raw.shorts,
      message: "fleet run step is missing shorts",
    }),
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

const requireFleetRunStepStateArrayField = ({
  value,
  message,
}: {
  readonly value: unknown
  readonly message: string
}): Either.Either<ReadonlyArray<FleetRunStepState>, ParseError> =>
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
    steps: requireFleetRunStepStateArrayField({
      value: raw.steps,
      message: "fleet run summary is missing steps",
    }),
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

export type WaitRequestBody = {
  readonly until?: ReadonlyArray<SessionStateSlug>
  readonly untilOutput?: OutputPattern
  readonly via?: WaitVia
  readonly timeoutMs?: number
}

// What the wait is waiting FOR. An empty `until` never reaches the daemon,
// which rejects `[]` — in that case the condition lives in `untilOutput`.
const waitConditionFields = (wait: WaitParams): WaitRequestBody => ({
  ...(wait.until.length > 0 ? { until: wait.until } : {}),
  ...(wait.untilOutput === undefined ? {} : { untilOutput: wait.untilOutput }),
})

// How it waits. Both are omitted at their default so the body a plain
// `--until` wait sends is byte-identical to what this CLI sent before `via`
// existed, which keeps it acceptable to a daemon that predates the field.
const waitOptionFields = (wait: WaitParams): WaitRequestBody => ({
  ...(wait.via === DEFAULT_WAIT_VIA ? {} : { via: wait.via }),
  ...(wait.timeoutMs === undefined ? {} : { timeoutMs: wait.timeoutMs }),
})

export const buildWaitRequestBody = (wait: WaitParams): WaitRequestBody => ({
  ...waitConditionFields(wait),
  ...waitOptionFields(wait),
})

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

// A terminal row ready for column formatting — `atMs` is the shell's
// `Date.parse` of the entry's raw ISO `at`, the same split SessionRow uses.
export type TerminalRow = {
  readonly key: string
  readonly state: TerminalStateSlug
  readonly matcher: string | undefined
  readonly evidence: string | undefined
  readonly atMs: number | undefined
}

// The daemon caps evidence at 200 chars; a terminal row is one line, so cap it
// again at the same width `sessions` gives an intent.
const EVIDENCE_MAX_WIDTH = 48

const formatTerminalDetail = (row: TerminalRow): string =>
  [
    row.matcher,
    row.evidence === undefined
      ? undefined
      : truncate({ text: row.evidence, max: EVIDENCE_MAX_WIDTH }),
  ]
    .filter((part): part is string => part !== undefined)
    .join("  ")

const formatTerminalRow = ({
  row,
  now,
  keyWidth,
  stateWidth,
}: {
  readonly row: TerminalRow
  readonly now: number
  readonly keyWidth: number
  readonly stateWidth: number
}): string =>
  [
    padEndTo({ text: row.key, width: keyWidth }),
    padEndTo({ text: row.state, width: stateWidth }),
    formatAge(ageMs({ now, sinceMs: row.atMs })).padStart(4),
    formatTerminalDetail(row),
  ].join("  ")

// Same column discipline as formatSessions, and the same insertion order the
// daemon's own map has — no re-sorting, so a repeated call renders stably.
export const formatTerminalStates = ({
  terminals,
  now,
}: {
  readonly terminals: ReadonlyArray<TerminalRow>
  readonly now: number
}): string => {
  if (terminals.length === 0) return "no terminal states"
  const keyWidth = Math.max(8, ...terminals.map((t) => t.key.length))
  const stateWidth = Math.max(7, ...terminals.map((t) => t.state.length))
  return terminals.map((row) => formatTerminalRow({ row, now, keyWidth, stateWidth })).join("\n")
}

// The screen's own reading, with the provenance that lets a reader check the
// claim instead of taking it: which matcher fired, the line it matched, and how
// old the observation is. Each part is dropped when absent rather than printed
// as "undefined".
const screenFactParts = (terminal: ExplainTerminalFacts): ReadonlyArray<string> =>
  [
    terminal.state,
    terminal.matcher === undefined ? undefined : `matcher "${terminal.matcher}"`,
    terminal.evidence === undefined ? undefined : `matched "${terminal.evidence}"`,
    terminal.ageMs === undefined ? undefined : `${formatAge(terminal.ageMs)} ago`,
  ].filter((part): part is string => part !== undefined)

// Unlike the `pid alive` line below, this one is printed even when there is
// nothing to report: "no classification" is itself a diagnosis — it says a
// `--via screen` wait on this session has nothing to resolve against.
const formatExplainScreen = (terminal: ExplainTerminalFacts | undefined): string =>
  terminal === undefined
    ? "screen: not classified"
    : `screen: ${screenFactParts(terminal).join("  ")}`

// The strongest thing this command can say, so it goes directly under the
// header rather than at the end of the reason list. The daemon also spells the
// contradiction out in full among `reasons` (with provenance and what to
// distrust); this is the headline, that is the argument.
//
// The claim is attributed to `source`, not to "state.json": a pi run's state
// comes from the daemon's own spawn log and pi writes no status file at all, so
// naming the file here would invent provenance for exactly the sessions with the
// least of it. For a claude session `source` IS "state.json", so its headline is
// unchanged.
const formatExplainConflict = (explanation: ExplainSummary): string | undefined =>
  explanation.screenDisagrees && explanation.terminal !== undefined
    ? `!! screen disagrees: ${explanation.source} says "${explanation.state}", the screen reads "${explanation.terminal.state}"`
    : undefined

// Identity, then the contradiction if there is one, then what the screen says —
// the three lines a reader should not have to scroll for.
const explainHeaderLines = (explanation: ExplainSummary): ReadonlyArray<string> => {
  const conflict = formatExplainConflict(explanation)
  return [
    `${explanation.short}  ${explanation.state}${explanation.stale ? " (stale)" : ""}`,
    ...(conflict === undefined ? [] : [conflict]),
    formatExplainScreen(explanation.terminal),
  ]
}

export const formatExplain = (explanation: ExplainSummary): string => {
  const lines = [
    ...explainHeaderLines(explanation),
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
  // Says what to change, and deliberately avoids the word "timeout": the wait
  // never started, so reading this as "not yet" would be exactly wrong.
  screen_polling_disabled:
    "could not be watched: screen polling is disabled on this daemon (set PID_TERMINAL_POLL_MS)",
}

// "reached done via screen" and "reached done via supervisor" are different
// claims — the first says the pane looks finished, the second that the agent
// reported it — so the line names the observation whenever the daemon sent one.
const formatSatisfiedWait = (outcome: {
  readonly short: string
  readonly state: SessionStateSlug
  readonly via?: WaitSatisfiedVia
  readonly waitedMs: number
}): string => {
  const via = outcome.via === undefined ? "" : ` via ${outcome.via}`
  return `${outcome.short} reached "${outcome.state}"${via} after ${outcome.waitedMs}ms`
}

const formatSucceededWait = (outcome: Extract<WaitOutcomeBody, { readonly ok: true }>): string =>
  "matched" in outcome
    ? `${outcome.short} matched "${outcome.matched}" after ${outcome.waitedMs}ms`
    : formatSatisfiedWait(outcome)

export const formatWaitOutcome = (outcome: WaitOutcomeBody): string =>
  outcome.ok
    ? formatSucceededWait(outcome)
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

// --- State-change rules formatting --------------------------------------------

const formatRuleError = (e: RuleErrorSummary): string => `[${e.rule}] ${e.message}`

const RULE_LOG_TAIL = 10

// One helper per section, each returning `undefined` for "nothing to show"
// — mirrors sessions-explain.core.ts's buildReasons — so formatRulesStatus
// itself is just an array literal + filter + join, not a branch per section.
const formatRulesHeader = (s: RulesStatusSummary): string =>
  `state-change rules: ${s.enabled ? "enabled" : "disabled"}${s.paused ? " (paused)" : ""}`

const formatRulesList = (rules: ReadonlyArray<RuleSummary>): string =>
  rules.length === 0
    ? "no rules configured"
    : rules.map((r) => `  ${r.name}${r.enabled ? "" : " (disabled)"}`).join("\n")

const formatRulesErrorsSection = (errors: ReadonlyArray<RuleErrorSummary>): string | undefined =>
  errors.length === 0
    ? undefined
    : [`${errors.length} rule error(s):`, ...errors.map((e) => `  ${formatRuleError(e)}`)].join(
        "\n",
      )

const formatRulesActivitySection = (log: ReadonlyArray<RuleFiringLogEntry>): string | undefined =>
  log.length === 0
    ? undefined
    : [
        "recent activity:",
        ...log.slice(-RULE_LOG_TAIL).map((l) => `  ${l.tag} ${l.rule} → ${l.short}`),
      ].join("\n")

export const formatRulesStatus = (s: RulesStatusSummary): string =>
  [
    formatRulesHeader(s),
    formatRulesList(s.rules),
    formatRulesErrorsSection(s.errors),
    formatRulesActivitySection(s.log),
  ]
    .filter((section): section is string => section !== undefined)
    .join("\n\n")

export const formatRulesPreview = (p: RulesPreviewSummary): string => {
  if (p.errors.length > 0) {
    return [
      `${p.errors.length} rule error(s):`,
      ...p.errors.map((e) => `  ${formatRuleError(e)}`),
    ].join("\n")
  }
  if (p.outcomes.length === 0) return "preview: nothing would fire"
  return p.outcomes
    .map((o) => `${o.tag === "Fired" ? "would fire" : "suppressed"}: ${o.rule} → ${o.short}`)
    .join("\n")
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
