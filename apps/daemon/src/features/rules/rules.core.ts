import {
  isNamedKey,
  isSessionStateSlug,
  isTerminalMatcherName,
  isTerminalStateSlug,
  type NamedKey,
  type SessionStateSlug,
  STALE_ACTIVE_MS,
  TERMINAL_MATCHER_NAMES,
  TERMINAL_STATE_SLUGS,
  type TerminalMatcherName,
  type TerminalStateSlug,
} from "@pid/shared"
// Pure schema, validation and decision logic for state-change automation
// rules (<claudeConfigDir>/pid-dashboard/rules.json). No I/O — reading the
// file, subscribing to the SSE bus, the clock and the in-memory firing
// history all live in rules.io.ts; this file only turns already-decoded
// values into decisions.
//
// Motivation: herdr's own docs leave "when a session does X, do Y" to shell
// scripting over its CLI. This slice is that missing layer — but an
// automation that types into a live agent, or fires in a loop, is worse than
// no automation, so safety is load-bearing here, not an afterthought:
//
//   - Disabled by default. rules.io.ts never even calls `evaluate` unless
//     the file both exists and sets `enabled: true` at the top level.
//   - `keys` (typing into a live TUI) requires its own per-rule `confirm:
//     true` — there is no file-wide "allow keys". A rule missing it still
//     parses (its author may be building the rule up before turning the
//     dangerous part on); `evaluate` is what refuses to fire it.
//   - Two loop breakers, both enforced in `evaluate`: a per-(rule, session)
//     cooldown (DEFAULT_COOLDOWN_MS unless the rule sets its own), and a
//     per-session ceiling on actions across every rule combined
//     (CEILING_MAX_ACTIONS_PER_SESSION per CEILING_WINDOW_MS). A trip is
//     reported as a first-class `Suppressed` outcome, not silence.
//
// TWO READINGS, TWO TRIGGER SOURCES. A session has an independent supervisor
// reading (`state.json`, republished as `session.state`) and screen reading (the
// classifier's verdict on the pane itself, republished as `terminal.state`), and
// they disagree in exactly the cases automation is for: a permission prompt
// nobody answers, a folder-trust dialog, a pane that went quiet while
// `state.json` still claims `working`. `POST /sessions/:id/wait` already lets an
// agent pick its reading with `via`; a rule picks its reading by which key its
// `when` sets — `state` (supervisor) or `screen` (classifier). Every safety
// property above applies identically to both: the same file-wide `enabled`, the
// same per-rule `confirm` for `keys`, and the same cooldown/ceiling history,
// which is keyed by (rule, short) and therefore counts a supervisor firing
// against a screen rule's budget for the same session, and vice versa.

import { Either } from "effect"

// --- Borrowed vocabulary -----------------------------------------------------
//
// Every vocabulary this file validates against is imported from `@pid/shared`,
// not copied: the session-state slugs, the named keys, the staleness threshold,
// and (for screen triggers) the terminal-state slugs and the classifier's matcher
// names. That is only possible because each of them lives in `shared/`. This file
// is in `features/rules/`, and `bun run axiom-debt`'s cross-slice-import counter
// fails the build on any NEW violation of "a slice may only import another
// slice's *published* door, never its internals" — `sessions.core`,
// `sessions-keys.core`, `sessions-explain.core` and `terminal-state.core` are
// internals, not doors. The alternative used to be a literal copy behind a drift
// guard, and there were five of them in this repo; see AGENTS.md's "Contracts
// live in `shared/`" axiom for what that cost.
//
// Two narrowings below are genuinely this slice's own decisions rather than
// borrowed vocabulary, which is why they are declared here: which states a rule
// may trigger on, and the two-valued spelling of `harness`.

// The subset of session states a rule's `when.state` may target. `working` is
// excluded — a session actively working needs no automation reacting to it —
// and so is `stopped`: that session was already ended deliberately (a human,
// or `pid stop`), so nothing should react to it on its own. (`when.screen` is
// deliberately NOT narrowed this way — see ScreenWhen.)
const RULE_TRIGGER_STATES = ["blocked", "needs_input", "done", "failed", "idle", "unknown"] as const
export type RuleTriggerState = (typeof RULE_TRIGGER_STATES)[number]

const isRuleTriggerState = (s: string): s is RuleTriggerState =>
  (RULE_TRIGGER_STATES as readonly string[]).includes(s)

// The two-valued form of sessions.core.ts's `SessionState.harness?: "pi"`
// (absent = claude): a rule author writes `claude` explicitly rather than
// expressing "the claude case" as an absent field.
const HARNESS_VALUES = ["claude", "pi"] as const
export type Harness = (typeof HARNESS_VALUES)[number]

const isHarness = (s: string): s is Harness => (HARNESS_VALUES as readonly string[]).includes(s)

const ACTIVE_STATES: ReadonlySet<SessionStateSlug> = new Set(["working", "blocked", "needs_input"])

// Same verdict sessions-explain.core.ts's `computeStale` produces, recomputed
// here from data rules.io.ts pulls off the SSE bus payload itself (this
// slice cannot import that core's version — see the borrowed-vocabulary note
// above; the THRESHOLD it compares against is shared, only this two-line
// comparison is restated). `updatedAtAgeMs` is resolved by the shell
// (rules.io.ts), same contract as `ageMs` below.
export const computeStale = ({
  state,
  updatedAtAgeMs,
}: {
  readonly state: SessionStateSlug
  readonly updatedAtAgeMs: number | undefined
}): boolean => {
  if (!ACTIVE_STATES.has(state)) return false
  if (updatedAtAgeMs === undefined) return false
  return updatedAtAgeMs > STALE_ACTIVE_MS
}

// Both instants arrive as epoch milliseconds — this core neither reads the
// clock nor parses dates itself (mirrors sessions.core.ts's own `ageMs`).
export const ageMs = ({
  now,
  atMs,
}: {
  readonly now: number
  readonly atMs: number | undefined
}): number | undefined => {
  if (atMs === undefined || Number.isNaN(atMs)) return undefined
  return Math.max(0, now - atMs)
}

// --- Loop breakers -------------------------------------------------------------

// Per-(rule, session) cooldown applied when a rule doesn't set its own
// `cooldownMs` — long enough that a dwell rule re-checked on every tick
// cannot resend the same keystroke more than once every five minutes.
export const DEFAULT_COOLDOWN_MS = 300_000
// Sanity ceiling on an author-supplied cooldownMs — not a realistic value,
// just a guard against a typo (an extra zero) silently disabling a rule for
// a year. Not exported — only validateCooldownMs/validateWhenForMs need
// these; see AGENTS.md "State-change rules" for the documented values.
const MAX_COOLDOWN_MS = 86_400_000
const MIN_DWELL_MS = 1_000
const MAX_DWELL_MS = 86_400_000
// Per-session ceiling: across every rule combined, at most this many actions
// may fire for one session inside this rolling window — the backstop for
// several distinct rules piling onto the same blocked session even though
// each individually respects its own cooldown.
export const CEILING_WINDOW_MS = 600_000
export const CEILING_MAX_ACTIONS_PER_SESSION = 5

// --- Schema ----------------------------------------------------------------

export type SupervisorWhen = {
  readonly source: "supervisor"
  readonly state: RuleTriggerState
  // Present: a dwell condition ("state held for at least forMs"). Absent: a
  // transition condition ("just entered state").
  readonly forMs: number | undefined
  readonly harness: Harness | undefined
  readonly stale: boolean | undefined
}

export type ScreenWhen = {
  readonly source: "screen"
  // Every slug the classifier can report is a legal trigger, `working`
  // included — deliberately NOT narrowed the way RULE_TRIGGER_STATES is. "The
  // screen has read working for four hours" is a stuck-loop condition no
  // supervisor reading can express (state.json is not rewritten during a long
  // turn, so even `stale` misses it), and refusing it here would forbid the one
  // rule the screen uniquely makes possible.
  readonly screen: TerminalStateSlug
  // Which classifier row fired. A `blocked` screen is a tool-permission dialog
  // OR a folder-trust dialog, and those want different answers, so a rule that
  // sends keystrokes should almost always name the matcher it means. Absent
  // means "any matcher for this state".
  readonly matcher: TerminalMatcherName | undefined
  // Same two readings as SupervisorWhen.forMs, measured against the screen's
  // own dwell: present = "has read this for at least forMs", absent = "just
  // started reading this".
  readonly forMs: number | undefined
}

// `source` is DERIVED, not authored: a rules file sets `when.state` or
// `when.screen` and the parser tags which one it saw. It is part of the parsed
// shape (so `GET /rules` shows a reader which reading each rule watches) and the
// discriminant `evaluate` / `evaluateScreen` filter on, so neither evaluator can
// read a screen observation through a supervisor rule.
export type RuleWhen = SupervisorWhen | ScreenWhen

export type NotifyAction = {
  readonly action: "notify"
  readonly message: string
}

export type KeysAction = {
  readonly action: "keys"
  readonly sequence: ReadonlyArray<NamedKey>
  // No file-wide "allow keys" — this per-rule flag is the only way a `keys`
  // action is ever actually sent; see `evaluate`'s KeysNotConfirmed check.
  readonly confirm: boolean
}

export type StopAction = {
  readonly action: "stop"
}

export type RuleAction = NotifyAction | KeysAction | StopAction

export type Rule = {
  readonly name: string
  readonly enabled: boolean
  readonly when: RuleWhen
  readonly do: RuleAction
  readonly cooldownMs: number
}

export type RulesFile = {
  // The file-wide opt-in. Absent or false: rules.io.ts never calls
  // `evaluate`, full stop — see this file's header.
  readonly enabled: boolean
  readonly rules: ReadonlyArray<Rule>
}

export type RuleError = {
  // A rule's own `name` once known, its positional label ("rule #N") before
  // that, or "(file)" for a problem scoped to the document as a whole —
  // mirrors fleet.core.ts's FleetError.
  readonly rule: string
  readonly message: string
}

const MAX_KEYS_SEQUENCE_STEPS = 32

const ruleErr = ({
  rule,
  message,
}: {
  readonly rule: string
  readonly message: string
}): RuleError => ({ rule, message })

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)

const isNonEmptyString = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0

const ruleLabelFor = ({ raw, index }: { readonly raw: unknown; readonly index: number }): string =>
  isPlainObject(raw) && isNonEmptyString(raw.name) ? raw.name : `rule #${index + 1}`

// --- `when` validation -------------------------------------------------------

type WhenCtx = { readonly raw: Record<string, unknown>; readonly label: string }

const validateWhenState = ({ raw, label }: WhenCtx): readonly RuleError[] =>
  typeof raw.state === "string" && isRuleTriggerState(raw.state)
    ? []
    : [
        ruleErr({
          rule: label,
          message: `when.state must be one of: ${RULE_TRIGGER_STATES.join(", ")}`,
        }),
      ]

const validateWhenForMs = ({ raw, label }: WhenCtx): readonly RuleError[] => {
  if (raw.forMs === undefined) return []
  const t = raw.forMs
  return typeof t === "number" && Number.isInteger(t) && t >= MIN_DWELL_MS && t <= MAX_DWELL_MS
    ? []
    : [
        ruleErr({
          rule: label,
          message: `when.forMs must be an integer between ${MIN_DWELL_MS} and ${MAX_DWELL_MS}`,
        }),
      ]
}

const validateWhenHarness = ({ raw, label }: WhenCtx): readonly RuleError[] => {
  if (raw.harness === undefined) return []
  return typeof raw.harness === "string" && isHarness(raw.harness)
    ? []
    : [
        ruleErr({
          rule: label,
          message: `when.harness must be one of: ${HARNESS_VALUES.join(", ")}`,
        }),
      ]
}

const validateWhenStale = ({ raw, label }: WhenCtx): readonly RuleError[] => {
  if (raw.stale === undefined) return []
  return typeof raw.stale === "boolean"
    ? []
    : [ruleErr({ rule: label, message: "when.stale must be a boolean" })]
}

const validateWhenScreenState = ({ raw, label }: WhenCtx): readonly RuleError[] =>
  isTerminalStateSlug(raw.screen)
    ? []
    : [
        ruleErr({
          rule: label,
          message: `when.screen must be one of: ${TERMINAL_STATE_SLUGS.join(", ")}`,
        }),
      ]

const validateWhenMatcher = ({ raw, label }: WhenCtx): readonly RuleError[] => {
  if (raw.matcher === undefined) return []
  if (!isTerminalMatcherName(raw.matcher)) {
    return [
      ruleErr({
        rule: label,
        message: `when.matcher must be one of: ${TERMINAL_MATCHER_NAMES.join(", ")}`,
      }),
    ]
  }
  // `unknown` IS "no matcher fired", so the pair describes a screen that cannot
  // exist. Rejecting it at parse time beats a rule that quietly never fires.
  return raw.screen === "unknown"
    ? [
        ruleErr({
          rule: label,
          message:
            'when.matcher cannot be combined with when.screen "unknown" — an unclassified screen has no matcher',
        }),
      ]
    : []
}

// A field that belongs to the OTHER source is an error, never a silent no-op:
// an author who writes `harness` on a screen rule believes the rule is narrower
// than it is, and would only find out by watching it fire on the wrong session.
const wrongSourceFields = ({
  raw,
  label,
  fields,
  belongsTo,
}: WhenCtx & {
  readonly fields: ReadonlyArray<string>
  readonly belongsTo: "supervisor" | "screen"
}): readonly RuleError[] =>
  fields
    .filter((field) => raw[field] !== undefined)
    .map((field) =>
      ruleErr({
        rule: label,
        message: `when.${field} applies to a ${belongsTo} trigger only`,
      }),
    )

const validateSupervisorWhen = ({ raw, label }: WhenCtx): readonly RuleError[] => [
  ...validateWhenState({ raw, label }),
  ...validateWhenForMs({ raw, label }),
  ...validateWhenHarness({ raw, label }),
  ...validateWhenStale({ raw, label }),
  ...wrongSourceFields({ raw, label, fields: ["matcher"], belongsTo: "screen" }),
]

// `harness` and `stale` are supervisor-only by nature, not by omission:
// `harness` comes off a `session.state` payload the screen path never sees, and
// `stale` is a verdict about how long ago state.json was written — the screen
// classification is itself the better answer to that question.
const validateScreenWhen = ({ raw, label }: WhenCtx): readonly RuleError[] => [
  ...validateWhenScreenState({ raw, label }),
  ...validateWhenMatcher({ raw, label }),
  ...validateWhenForMs({ raw, label }),
  ...wrongSourceFields({ raw, label, fields: ["harness", "stale"], belongsTo: "supervisor" }),
]

const validateWhen = ({ raw, label }: WhenCtx): readonly RuleError[] => {
  const hasState = raw.state !== undefined
  const hasScreen = raw.screen !== undefined
  if (hasState === hasScreen) {
    return [
      ruleErr({
        rule: label,
        message:
          "when must set exactly one of state (the supervisor's reading) or screen (the classifier's reading)",
      }),
    ]
  }
  return hasScreen ? validateScreenWhen({ raw, label }) : validateSupervisorWhen({ raw, label })
}

// Safe only once validateWhen (above) has already confirmed every field's
// shape — mirrors fleet.core.ts's buildStep.
const buildWhen = (raw: Record<string, unknown>): RuleWhen =>
  raw.screen === undefined
    ? {
        source: "supervisor",
        state: raw.state as RuleTriggerState,
        forMs: raw.forMs as number | undefined,
        harness: raw.harness as Harness | undefined,
        stale: raw.stale as boolean | undefined,
      }
    : {
        source: "screen",
        screen: raw.screen as TerminalStateSlug,
        matcher: raw.matcher as TerminalMatcherName | undefined,
        forMs: raw.forMs as number | undefined,
      }

// --- `do` validation -------------------------------------------------------

type DoCtx = { readonly raw: Record<string, unknown>; readonly label: string }

const validateNotifyDo = ({ raw, label }: DoCtx): readonly RuleError[] =>
  isNonEmptyString(raw.message)
    ? []
    : [
        ruleErr({
          rule: label,
          message: "do.message must be a non-empty string for a notify action",
        }),
      ]

const validateKeysSequence = ({ raw, label }: DoCtx): readonly RuleError[] => {
  const seq = raw.sequence
  if (!Array.isArray(seq) || seq.length === 0) {
    return [
      ruleErr({ rule: label, message: "do.sequence must be a non-empty array for a keys action" }),
    ]
  }
  if (seq.length > MAX_KEYS_SEQUENCE_STEPS) {
    return [
      ruleErr({
        rule: label,
        message: `do.sequence exceeds the ${MAX_KEYS_SEQUENCE_STEPS}-step cap`,
      }),
    ]
  }
  const bad = seq.find((s) => typeof s !== "string" || !isNamedKey(s))
  return bad === undefined
    ? []
    : [
        ruleErr({
          rule: label,
          message: `do.sequence contains an unknown key name: ${JSON.stringify(bad)}`,
        }),
      ]
}

const validateKeysConfirm = ({ raw, label }: DoCtx): readonly RuleError[] => {
  if (raw.confirm === undefined) return []
  return typeof raw.confirm === "boolean"
    ? []
    : [ruleErr({ rule: label, message: "do.confirm must be a boolean" })]
}

const validateKeysDo = (ctx: DoCtx): readonly RuleError[] => [
  ...validateKeysSequence(ctx),
  ...validateKeysConfirm(ctx),
]

const validateDo = ({ raw, label }: DoCtx): readonly RuleError[] => {
  const action = raw.action
  if (action === "notify") return validateNotifyDo({ raw, label })
  if (action === "keys") return validateKeysDo({ raw, label })
  if (action === "stop") return []
  return [ruleErr({ rule: label, message: 'do.action must be one of: "notify", "keys", "stop"' })]
}

// Safe only once validateDo has confirmed the shape for `raw.action`.
const buildDo = (raw: Record<string, unknown>): RuleAction => {
  if (raw.action === "notify") return { action: "notify", message: raw.message as string }
  if (raw.action === "keys") {
    return {
      action: "keys",
      sequence: raw.sequence as ReadonlyArray<NamedKey>,
      confirm: raw.confirm === true,
    }
  }
  return { action: "stop" }
}

// --- One rule ----------------------------------------------------------------

const validateRuleName = ({
  raw,
  label,
}: {
  readonly raw: Record<string, unknown>
  readonly label: string
}): readonly RuleError[] =>
  isNonEmptyString(raw.name)
    ? []
    : [ruleErr({ rule: label, message: "name must be a non-empty string" })]

const validateRuleEnabled = ({
  raw,
  label,
}: {
  readonly raw: Record<string, unknown>
  readonly label: string
}): readonly RuleError[] => {
  if (raw.enabled === undefined) return []
  return typeof raw.enabled === "boolean"
    ? []
    : [ruleErr({ rule: label, message: "enabled must be a boolean" })]
}

const validateCooldownMs = ({
  raw,
  label,
}: {
  readonly raw: Record<string, unknown>
  readonly label: string
}): readonly RuleError[] => {
  if (raw.cooldownMs === undefined) return []
  const c = raw.cooldownMs
  return typeof c === "number" && Number.isInteger(c) && c >= 0 && c <= MAX_COOLDOWN_MS
    ? []
    : [
        ruleErr({
          rule: label,
          message: `cooldownMs must be an integer between 0 and ${MAX_COOLDOWN_MS}`,
        }),
      ]
}

const validateRuleWhenShape = ({
  raw,
  label,
}: {
  readonly raw: Record<string, unknown>
  readonly label: string
}): readonly RuleError[] =>
  isPlainObject(raw.when)
    ? validateWhen({ raw: raw.when, label })
    : [ruleErr({ rule: label, message: "when must be an object" })]

const validateRuleDoShape = ({
  raw,
  label,
}: {
  readonly raw: Record<string, unknown>
  readonly label: string
}): readonly RuleError[] =>
  isPlainObject(raw.do)
    ? validateDo({ raw: raw.do, label })
    : [ruleErr({ rule: label, message: "do must be an object" })]

type RuleParse = {
  readonly name: string | undefined
  readonly rule: Rule | undefined
  readonly errors: readonly RuleError[]
}

const parseOneRule = ({
  raw,
  index,
}: {
  readonly raw: unknown
  readonly index: number
}): RuleParse => {
  const label = ruleLabelFor({ raw, index })
  if (!isPlainObject(raw)) {
    return {
      name: undefined,
      rule: undefined,
      errors: [ruleErr({ rule: label, message: "rule must be an object" })],
    }
  }
  const errors = [
    ...validateRuleName({ raw, label }),
    ...validateRuleEnabled({ raw, label }),
    ...validateRuleWhenShape({ raw, label }),
    ...validateRuleDoShape({ raw, label }),
    ...validateCooldownMs({ raw, label }),
  ]
  if (errors.length > 0) {
    return { name: isNonEmptyString(raw.name) ? raw.name : undefined, rule: undefined, errors }
  }
  return {
    name: raw.name as string,
    rule: {
      name: raw.name as string,
      enabled: raw.enabled === undefined ? true : (raw.enabled as boolean),
      when: buildWhen(raw.when as Record<string, unknown>),
      do: buildDo(raw.do as Record<string, unknown>),
      cooldownMs: raw.cooldownMs === undefined ? DEFAULT_COOLDOWN_MS : (raw.cooldownMs as number),
    },
    errors: [],
  }
}

// One error per duplicated name (not one per occurrence) — mirrors
// fleet.core.ts's findDuplicateStepIds.
const findDuplicateRuleNames = (parsed: readonly RuleParse[]): readonly RuleError[] => {
  const seen = new Set<string>()
  const dupes = new Set<string>()
  for (const p of parsed) {
    if (p.name === undefined) continue
    if (seen.has(p.name)) dupes.add(p.name)
    seen.add(p.name)
  }
  return [...dupes]
    .sort()
    .map((name) => ruleErr({ rule: name, message: `duplicate rule name: "${name}"` }))
}

// Validates an untrusted rules.json body (already JSON.parse'd — a malformed
// JSON string itself is reported by rules.io.ts as its own "(file)"-scoped
// RuleError, mirroring fleet.io.ts's readFleetFile). Collects EVERY error
// across every rule rather than stopping at the first, the same reason
// fleet.core.ts's parseFleetFile does: a hand-edited file wants the full
// worklist in one pass.
export const parseRulesFile = (
  raw: unknown,
): Either.Either<RulesFile, ReadonlyArray<RuleError>> => {
  if (!isPlainObject(raw)) {
    return Either.left([ruleErr({ rule: "(file)", message: "root must be an object" })])
  }
  const enabledErrors: readonly RuleError[] =
    raw.enabled !== undefined && typeof raw.enabled !== "boolean"
      ? [ruleErr({ rule: "(file)", message: "enabled must be a boolean" })]
      : []
  if (raw.rules !== undefined && !Array.isArray(raw.rules)) {
    return Either.left([
      ...enabledErrors,
      ruleErr({ rule: "(file)", message: "rules must be an array" }),
    ])
  }
  const rulesRaw: readonly unknown[] = raw.rules ?? []
  const parsed = rulesRaw.map((r, index) => parseOneRule({ raw: r, index }))
  const errors = [
    ...enabledErrors,
    ...parsed.flatMap((p) => p.errors),
    ...findDuplicateRuleNames(parsed),
  ]
  if (errors.length > 0) return Either.left(errors)
  return Either.right({
    enabled: raw.enabled === true,
    rules: parsed.map((p) => p.rule as Rule),
  })
}

// --- Bus-payload decoding ----------------------------------------------------
//
// `session.state` / `session.removed` events on the SSE bus carry `unknown`
// data; these turn a raw payload into what `evaluate` needs, or `undefined`
// on anything unexpected — never a cast, never a throw. Mirrors
// sessions-wait.core.ts's own `decodeSessionStateEvent` /
// `decodeSessionRemovedEvent`, kept as a separate copy (not imported — see
// the mirrored-vocabulary note above) because this slice also needs
// `harness`, which that decoder doesn't carry.

export type DecodedSessionState = {
  readonly short: string
  readonly state: SessionStateSlug
  readonly harness: Harness
  // Raw ISO string, same contract as sessions.core.ts's own `updatedAt` —
  // parsing it into epoch ms is the shell's job (Date.parse is a banned
  // global in *.core.ts).
  readonly updatedAt: string | undefined
}

export const decodeSessionStatePayload = (payload: unknown): DecodedSessionState | undefined => {
  if (!isPlainObject(payload)) return undefined
  const { short, state, harness, updatedAt } = payload
  if (!isNonEmptyString(short)) return undefined
  if (typeof state !== "string" || !isSessionStateSlug(state)) return undefined
  return {
    short,
    state,
    harness: harness === "pi" ? "pi" : "claude",
    updatedAt: typeof updatedAt === "string" ? updatedAt : undefined,
  }
}

export const decodeSessionRemovedPayload = (payload: unknown): string | undefined => {
  if (!isPlainObject(payload)) return undefined
  const { short } = payload
  return isNonEmptyString(short) ? short : undefined
}

export type DecodedTerminalState = {
  // `terminal.state` is keyed by `{ scope, id }`; only `scope: "session"` makes
  // `id` a session short, which is the only thing a rule can address.
  readonly short: string
  readonly state: TerminalStateSlug
  // Kept as an opaque string rather than narrowed to `TerminalMatcherName`, on
  // purpose: a matcher name this build does not know does not make the STATE
  // untrustworthy, so the observation is still worth having — a matcher-scoped
  // rule simply will not match it, which is the correct outcome. Narrowing here
  // would instead discard the whole event.
  readonly matcher: string | undefined
}

// The screen half of the bus decoding, same discipline as the two decoders above
// (`undefined` on anything unexpected, never a cast, never a throw). The payload
// is the record `terminal.routes.ts`'s single writer `publishTerminalState`
// publishes: `{ scope, id, state, matcher?, evidence?, at }`. `evidence` — a line
// of raw screen text — is deliberately dropped here: no rule condition reads it,
// and not carrying it into the engine's retained per-session view is one less
// place terminal contents can leak out of.
export const decodeTerminalStatePayload = (payload: unknown): DecodedTerminalState | undefined => {
  if (!isPlainObject(payload)) return undefined
  const { scope, id, state, matcher } = payload
  if (scope !== "session") return undefined
  if (!isNonEmptyString(id)) return undefined
  if (!isTerminalStateSlug(state)) return undefined
  return { short: id, state, matcher: isNonEmptyString(matcher) ? matcher : undefined }
}

// --- Session-view bookkeeping (pure) -----------------------------------------
//
// rules.io.ts keeps one SessionView per short, updated on every decoded
// `session.state` event; this is the pure "what changes" half of that update
// — the Map itself, and deciding when to call it, is the shell's job.

export type SessionView = {
  readonly short: string
  readonly state: SessionStateSlug
  readonly harness: Harness
  // epoch ms this session most recently entered `state` — the anchor a dwell
  // condition's `forMs` is measured from.
  readonly stateEnteredAt: number
  readonly updatedAtMs: number | undefined
}

export type ApplyStateEventResult = {
  readonly view: SessionView
  readonly prior: SessionStateSlug | undefined
  readonly transitioned: boolean
}

// `updatedAtMs` is already resolved (Date.parse'd) by the caller — see
// DecodedSessionState's own comment for why this core never parses dates.
export const applyStateEvent = ({
  existing,
  short,
  state,
  harness,
  updatedAtMs,
  now,
}: {
  readonly existing: SessionView | undefined
  readonly short: string
  readonly state: SessionStateSlug
  readonly harness: Harness
  readonly updatedAtMs: number | undefined
  readonly now: number
}): ApplyStateEventResult => {
  const prior = existing?.state
  const transitioned = prior !== state
  return {
    view: {
      short,
      state,
      harness,
      stateEnteredAt: transitioned ? now : (existing?.stateEnteredAt ?? now),
      updatedAtMs,
    },
    prior,
    transitioned,
  }
}

// The screen equivalent, kept in its own map by rules.io.ts rather than folded
// into SessionView. Two reasons, both about honesty: a `terminal.state` event
// carries no supervisor state or harness, so merging would mean inventing one for
// a pane whose session has never published a `session.state`; and the two
// readings have independent dwell anchors — a pane can go quiet while state.json
// keeps claiming `working`, which is the whole condition screen rules exist for.
export type ScreenView = {
  readonly short: string
  readonly state: TerminalStateSlug
  readonly matcher: string | undefined
  readonly stateEnteredAt: number
}

export type ApplyScreenEventResult = {
  readonly view: ScreenView
  readonly prior: TerminalStateSlug | undefined
  readonly transitioned: boolean
}

// Mirrors applyStateEvent. Note what a same-state observation does and does not
// change: the matcher is always the newest evidence, so it is taken every time,
// while `stateEnteredAt` only moves on a real transition.
//
// A known, deliberate limit of that: the poller publishes only on a STATE change
// (`decideTransition` in terminal-state.core.ts — a matcher swap inside one state
// is not a transition, and gating it otherwise would mean an SSE event per
// spinner frame). So if a pane's matcher changes while its state does not, this
// engine keeps the matcher it last SAW. For `blocked` — the state matcher-scoped
// rules are actually written against — that means a rule keys on whichever dialog
// first blocked the pane, which is also the dialog a human would answer first.
export const applyScreenEvent = ({
  existing,
  short,
  state,
  matcher,
  now,
}: {
  readonly existing: ScreenView | undefined
  readonly short: string
  readonly state: TerminalStateSlug
  readonly matcher: string | undefined
  readonly now: number
}): ApplyScreenEventResult => {
  const prior = existing?.state
  const transitioned = prior !== state
  return {
    view: {
      short,
      state,
      matcher,
      stateEnteredAt: transitioned ? now : (existing?.stateEnteredAt ?? now),
    },
    prior,
    transitioned,
  }
}

// --- Evaluation ----------------------------------------------------------------

export type SessionSnapshot = {
  readonly short: string
  readonly state: SessionStateSlug
  readonly harness: Harness
  readonly stale: boolean
}

export type FiringRecord = {
  readonly rule: string
  readonly short: string
  readonly at: number
}

export type Suppression =
  | { readonly _tag: "Disabled" }
  | { readonly _tag: "Cooldown"; readonly remainingMs: number }
  | { readonly _tag: "Ceiling"; readonly windowMs: number; readonly max: number }
  | { readonly _tag: "KeysNotConfirmed" }

export type RuleOutcome =
  | {
      readonly _tag: "Fired"
      readonly rule: string
      readonly short: string
      readonly action: RuleAction
    }
  | {
      readonly _tag: "Suppressed"
      readonly rule: string
      readonly short: string
      readonly action: RuleAction
      readonly reason: Suppression
    }

export type EvaluateInput = {
  readonly rules: RulesFile
  readonly session: SessionSnapshot
  // The session's state immediately before this evaluation — `undefined` for
  // "never seen before" (which still counts as "just entered" for a
  // transition condition). Pass `session.state` itself (no-op transition) on
  // a periodic dwell sweep so a transition-only rule never double-fires.
  readonly prior: SessionStateSlug | undefined
  // How long the session has held `session.state`, in ms; irrelevant to a
  // transition condition, required for a dwell one.
  readonly dwellMs: number
  readonly now: number
  // Every action this engine has actually FIRED so far (not suppressions —
  // those never count against the loop breakers below).
  readonly history: ReadonlyArray<FiringRecord>
}

// Shared by both sources: `forMs` present is a dwell condition, absent is a
// transition condition. Callers pass `prior === current` on a periodic sweep so a
// transition-only rule cannot re-fire on every tick.
const timingMatches = ({
  forMs,
  dwellMs,
  entered,
}: {
  readonly forMs: number | undefined
  readonly dwellMs: number
  readonly entered: boolean
}): boolean => (forMs !== undefined ? dwellMs >= forMs : entered)

const whenMatches = ({
  when,
  session,
  prior,
  dwellMs,
}: {
  readonly when: SupervisorWhen
  readonly session: SessionSnapshot
  readonly prior: SessionStateSlug | undefined
  readonly dwellMs: number
}): boolean => {
  if (session.state !== when.state) return false
  if (when.harness !== undefined && when.harness !== session.harness) return false
  if (when.stale !== undefined && when.stale !== session.stale) return false
  return timingMatches({ forMs: when.forMs, dwellMs, entered: prior !== session.state })
}

// The matcher comparison is what makes `permission-prompt` and
// `workspace-trust-prompt` different rules. It also means a matcher-scoped rule
// can never match an `unknown` screen: that classification carries no matcher, so
// there is no evidence to act on — the state may well still be blocked, and the
// rule still declines. That asymmetry is the point, not an oversight.
const screenWhenMatches = ({
  when,
  screen,
  prior,
  dwellMs,
}: {
  readonly when: ScreenWhen
  readonly screen: ScreenSnapshot
  readonly prior: TerminalStateSlug | undefined
  readonly dwellMs: number
}): boolean => {
  if (screen.state !== when.screen) return false
  if (when.matcher !== undefined && when.matcher !== screen.matcher) return false
  return timingMatches({ forMs: when.forMs, dwellMs, entered: prior !== screen.state })
}

const lastFiredAt = ({
  history,
  rule,
  short,
}: {
  readonly history: ReadonlyArray<FiringRecord>
  readonly rule: string
  readonly short: string
}): number | undefined => {
  let last: number | undefined
  for (const rec of history) {
    if (rec.rule === rule && rec.short === short && (last === undefined || rec.at > last))
      last = rec.at
  }
  return last
}

// Cooldown / ceiling operate on the FIRED-only history — a suppressed
// attempt never itself counts against either breaker.
const suppressionFor = ({
  rule,
  short,
  now,
  history,
}: {
  readonly rule: Rule
  readonly short: string
  readonly now: number
  readonly history: ReadonlyArray<FiringRecord>
}): Suppression | undefined => {
  if (!rule.enabled) return { _tag: "Disabled" }
  const last = lastFiredAt({ history, rule: rule.name, short })
  if (last !== undefined) {
    const remaining = rule.cooldownMs - (now - last)
    if (remaining > 0) return { _tag: "Cooldown", remainingMs: remaining }
  }
  const count = history.filter(
    (rec) => rec.short === short && now - rec.at <= CEILING_WINDOW_MS,
  ).length
  if (count >= CEILING_MAX_ACTIONS_PER_SESSION) {
    return { _tag: "Ceiling", windowMs: CEILING_WINDOW_MS, max: CEILING_MAX_ACTIONS_PER_SESSION }
  }
  if (rule.do.action === "keys" && !rule.do.confirm) return { _tag: "KeysNotConfirmed" }
  return undefined
}

// The half both sources share once matching is settled: a matched rule is either
// Fired or Suppressed-with-a-reason, and nothing else. Keeping this source-blind
// is what makes "every safety property applies identically to a screen rule" a
// structural fact rather than a promise — there is only one place that decides.
const outcomeFor = ({
  rule,
  short,
  matched,
  now,
  history,
}: {
  readonly rule: Rule
  readonly short: string
  readonly matched: boolean
  readonly now: number
  readonly history: ReadonlyArray<FiringRecord>
}): RuleOutcome | undefined => {
  if (!matched) return undefined
  const reason = suppressionFor({ rule, short, now, history })
  if (reason !== undefined) {
    return { _tag: "Suppressed", rule: rule.name, short, action: rule.do, reason }
  }
  return { _tag: "Fired", rule: rule.name, short, action: rule.do }
}

// One session's SUPERVISOR reading against every rule in the file. Screen rules
// are skipped by their `source` tag — a screen rule's condition is not a claim
// about `session.state` and must not be tested against one. Only rules whose
// `when` actually matched appear in the result: a rule that matches nothing is
// not an error and produces no entry (see this file's header). rules.io.ts calls
// this once per session per bus event (a real transition) and once per session
// per tick (dwell sweep, with `prior` set to `session.state` so a transition-only
// rule cannot re-fire on every tick).
export const evaluate = ({
  rules,
  session,
  prior,
  dwellMs,
  now,
  history,
}: EvaluateInput): ReadonlyArray<RuleOutcome> =>
  rules.rules.flatMap((rule) => {
    const matched =
      rule.when.source === "supervisor" && whenMatches({ when: rule.when, session, prior, dwellMs })
    const outcome = outcomeFor({ rule, short: session.short, matched, now, history })
    return outcome === undefined ? [] : [outcome]
  })

export type ScreenSnapshot = {
  readonly short: string
  readonly state: TerminalStateSlug
  readonly matcher: string | undefined
}

export type EvaluateScreenInput = {
  readonly rules: RulesFile
  readonly screen: ScreenSnapshot
  // The screen state immediately before this evaluation — `undefined` for a pane
  // this engine has never classified, which counts as "just started reading
  // this". Pass `screen.state` on a dwell sweep, same contract as EvaluateInput.
  readonly prior: TerminalStateSlug | undefined
  readonly dwellMs: number
  readonly now: number
  // The SAME history `evaluate` reads. Deliberately not a separate screen
  // history: the cooldown is per (rule, short) and the ceiling is per short, so a
  // supervisor rule that already fired for this session spends the budget a
  // screen rule would otherwise have.
  readonly history: ReadonlyArray<FiringRecord>
}

// One session's SCREEN reading against every rule in the file — the mirror of
// `evaluate`, sharing its suppression path wholesale.
export const evaluateScreen = ({
  rules,
  screen,
  prior,
  dwellMs,
  now,
  history,
}: EvaluateScreenInput): ReadonlyArray<RuleOutcome> =>
  rules.rules.flatMap((rule) => {
    const matched =
      rule.when.source === "screen" &&
      screenWhenMatches({ when: rule.when, screen, prior, dwellMs })
    const outcome = outcomeFor({ rule, short: screen.short, matched, now, history })
    return outcome === undefined ? [] : [outcome]
  })
