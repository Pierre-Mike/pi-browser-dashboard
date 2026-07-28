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

import { Either } from "effect"

// --- Mirrored vocabulary -----------------------------------------------------
//
// Mirrors `KNOWN_STATES` (sessions.core.ts), `NAMED_KEYS`
// (sessions-keys.core.ts), the `harness` field (sessions.core.ts's
// `SessionState.harness`) and `STALE_ACTIVE_MS` (sessions-explain.core.ts) as
// LITERAL copies rather than imports: this file lives in `features/rules/`,
// and `bun run axiom-debt`'s cross-slice-import counter fails the build on
// any NEW violation of "a slice may only import another slice's *published*
// door, never its internals" — sessions.core / sessions-keys.core /
// sessions-explain.core are internals, not a door. `fleet.core.ts` and
// `apps/cli/src/agent/agent.core.ts` hit the identical constraint and keep
// the same kind of literal copy — see those files' own comments for the
// precedent. Kept honest by scripts/mirrored-constants.test.ts, which
// imports the real values and asserts these copies still match.
export const SESSION_STATE_SLUGS = [
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

// Not exported — nothing outside this file needs the predicate itself, only
// the `SessionStateSlug` type it narrows to (which rules.io.ts does import).
const isSessionStateSlug = (s: string): s is SessionStateSlug =>
  (SESSION_STATE_SLUGS as readonly string[]).includes(s)

// The subset of states a rule's `when.state` may target. `working` is
// excluded — a session actively working needs no automation reacting to it —
// and so is `stopped`: that session was already ended deliberately (a human,
// or `pid stop`), so nothing should react to it on its own. Not exported —
// see `SESSION_STATE_SLUGS`'s comment above.
const RULE_TRIGGER_STATES = ["blocked", "needs_input", "done", "failed", "idle", "unknown"] as const
export type RuleTriggerState = (typeof RULE_TRIGGER_STATES)[number]

const isRuleTriggerState = (s: string): s is RuleTriggerState =>
  (RULE_TRIGGER_STATES as readonly string[]).includes(s)

// Mirrors sessions.core.ts's `SessionState.harness?: "pi"` (absent = claude).
// Not exported — see `SESSION_STATE_SLUGS`'s comment above.
const HARNESS_VALUES = ["claude", "pi"] as const
export type Harness = (typeof HARNESS_VALUES)[number]

const isHarness = (s: string): s is Harness => (HARNESS_VALUES as readonly string[]).includes(s)

// Mirrors sessions-keys.core.ts's `NAMED_KEYS` — deliberately excludes
// ctrl-z/ctrl-c for the same reason that file gives: they are the terminal's
// own escape hatches, not app-facing keys.
export const NAMED_KEYS = [
  "escape",
  "enter",
  "tab",
  "shift-tab",
  "up",
  "down",
  "right",
  "left",
  "home",
  "end",
  "page-up",
  "page-down",
  "backspace",
  "delete",
  "space",
] as const
export type NamedKey = (typeof NAMED_KEYS)[number]

const isNamedKey = (s: string): s is NamedKey => (NAMED_KEYS as readonly string[]).includes(s)

// Mirrors sessions-explain.core.ts's `STALE_ACTIVE_MS` — the threshold a
// rule's optional `when.stale` condition is judged against.
export const STALE_ACTIVE_MS = 120_000

const ACTIVE_STATES: ReadonlySet<SessionStateSlug> = new Set(["working", "blocked", "needs_input"])

// Same verdict sessions-explain.core.ts's `computeStale` produces, recomputed
// here from data rules.io.ts pulls off the SSE bus payload itself (this
// slice cannot import that core's version — see the mirrored-vocabulary note
// above). `updatedAtAgeMs` is resolved by the shell (rules.io.ts), same
// contract as `ageMs` below.
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

export type RuleWhen = {
  readonly state: RuleTriggerState
  // Present: a dwell condition ("state held for at least forMs"). Absent: a
  // transition condition ("just entered state").
  readonly forMs: number | undefined
  readonly harness: Harness | undefined
  readonly stale: boolean | undefined
}

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

const validateWhen = ({ raw, label }: WhenCtx): readonly RuleError[] => [
  ...validateWhenState({ raw, label }),
  ...validateWhenForMs({ raw, label }),
  ...validateWhenHarness({ raw, label }),
  ...validateWhenStale({ raw, label }),
]

// Safe only once validateWhen (above) has already confirmed every field's
// shape — mirrors fleet.core.ts's buildStep.
const buildWhen = (raw: Record<string, unknown>): RuleWhen => ({
  state: raw.state as RuleTriggerState,
  forMs: raw.forMs as number | undefined,
  harness: raw.harness as Harness | undefined,
  stale: raw.stale as boolean | undefined,
})

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

const whenMatches = ({
  when,
  session,
  prior,
  dwellMs,
}: {
  readonly when: RuleWhen
  readonly session: SessionSnapshot
  readonly prior: SessionStateSlug | undefined
  readonly dwellMs: number
}): boolean => {
  if (session.state !== when.state) return false
  if (when.harness !== undefined && when.harness !== session.harness) return false
  if (when.stale !== undefined && when.stale !== session.stale) return false
  return when.forMs !== undefined ? dwellMs >= when.forMs : prior !== session.state
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

const evaluateRule = ({
  rule,
  session,
  prior,
  dwellMs,
  now,
  history,
}: {
  readonly rule: Rule
  readonly session: SessionSnapshot
  readonly prior: SessionStateSlug | undefined
  readonly dwellMs: number
  readonly now: number
  readonly history: ReadonlyArray<FiringRecord>
}): RuleOutcome | undefined => {
  if (!whenMatches({ when: rule.when, session, prior, dwellMs })) return undefined
  const reason = suppressionFor({ rule, short: session.short, now, history })
  if (reason !== undefined) {
    return { _tag: "Suppressed", rule: rule.name, short: session.short, action: rule.do, reason }
  }
  return { _tag: "Fired", rule: rule.name, short: session.short, action: rule.do }
}

// One session against every rule in the file. Only rules whose `when`
// actually matched appear in the result — a rule that matches nothing is not
// an error and produces no entry (see this file's header). rules.io.ts calls
// this once per session per bus event (a real transition) and once per
// session per tick (dwell sweep, with `prior` set to `session.state` so a
// transition-only rule cannot re-fire on every tick).
export const evaluate = ({
  rules,
  session,
  prior,
  dwellMs,
  now,
  history,
}: EvaluateInput): ReadonlyArray<RuleOutcome> =>
  rules.rules.flatMap((rule) => {
    const outcome = evaluateRule({ rule, session, prior, dwellMs, now, history })
    return outcome === undefined ? [] : [outcome]
  })
