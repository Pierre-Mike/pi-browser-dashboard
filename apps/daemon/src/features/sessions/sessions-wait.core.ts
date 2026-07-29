// Pure decision logic for server-owned waits on session state. No I/O — the
// SSE subscription, clock and timeout live in sessions-wait.io.ts; this file
// only turns already-decoded values into decisions.
//
// The two request vocabularies this file validates — `via` (which observation
// may settle the wait) and an output pattern's `anchor`/length cap — live in
// `@pid/shared`, because `apps/cli` validates a `--via` / `--until-output` flag
// against exactly the same rules before making a request. See shared/src/wait.ts
// for what each value means; a second declaration here is the drift that
// workspace exists to prevent.

import {
  DEFAULT_OUTPUT_ANCHOR,
  DEFAULT_WAIT_VIA,
  isOutputAnchor,
  isSessionStateSlug,
  isWaitVia,
  OUTPUT_ANCHORS,
  OUTPUT_PATTERN_MAX_CHARS,
  type OutputPattern,
  type SessionStateSlug,
  WAIT_TIMEOUT_DEFAULT_MS,
  WAIT_TIMEOUT_MAX_MS,
  WAIT_VIA_VALUES,
  type WaitVia,
} from "@pid/shared"
import { Either } from "effect"

export type WaitRequest = {
  readonly until: ReadonlyArray<SessionStateSlug>
  // A pattern the session's screen must show. Independent of `until`; see
  // parseWaitRequest for what supplying both means.
  readonly untilOutput: OutputPattern | undefined
  readonly timeoutMs: number
  readonly via: WaitVia
}

export type WaitRequestError = {
  readonly _tag: "BadUntil" | "BadTimeout" | "BadVia" | "BadPattern"
  readonly message: string
}

// Which sources a given `via` admits. Two predicates rather than one branchy
// switch: every call site below asks exactly one of these questions.
const viaAllowsSupervisor = (via: WaitVia): boolean => via !== "screen"

const viaAllowsScreen = (via: WaitVia): boolean => via !== "supervisor"

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)

const isNonEmptyString = (v: unknown): v is string => typeof v === "string" && v.length > 0

const badUntil = (message: string): WaitRequestError => ({ _tag: "BadUntil", message })

const badTimeout = (message: string): WaitRequestError => ({ _tag: "BadTimeout", message })

// Absent means `supervisor`: every caller written before the screen became a
// wait source keeps exactly the semantics it was written against.
const parseVia = (raw: unknown): Either.Either<WaitVia, WaitRequestError> => {
  if (raw === undefined) return Either.right(DEFAULT_WAIT_VIA)
  if (!isWaitVia(raw)) {
    return Either.left({
      _tag: "BadVia",
      message: `via must be one of ${WAIT_VIA_VALUES.join(", ")}`,
    })
  }
  return Either.right(raw)
}

// `until` may be omitted entirely when `untilOutput` carries the condition
// instead, but a wait with neither has nothing to wait for and is a 400 rather
// than a request that blocks until it times out.
const emptyUntilError = (outputRequested: boolean): WaitRequestError =>
  badUntil(
    outputRequested
      ? "until, when present, must be a non-empty array of session states"
      : "a wait needs until (a non-empty array of session states) or untilOutput",
  )

const parseUntilSlugs = (
  raw: ReadonlyArray<unknown>,
): Either.Either<ReadonlyArray<SessionStateSlug>, WaitRequestError> => {
  const slugs: SessionStateSlug[] = []
  for (const item of raw) {
    if (typeof item !== "string" || !isSessionStateSlug(item)) {
      return Either.left(badUntil(`until contains an unknown state: ${JSON.stringify(item)}`))
    }
    if (!slugs.includes(item)) slugs.push(item)
  }
  return Either.right(slugs)
}

const parseUntil = ({
  raw,
  outputRequested,
}: {
  readonly raw: unknown
  readonly outputRequested: boolean
}): Either.Either<ReadonlyArray<SessionStateSlug>, WaitRequestError> => {
  if (raw === undefined && outputRequested) return Either.right([])
  if (!Array.isArray(raw) || raw.length === 0) {
    return Either.left(emptyUntilError(outputRequested))
  }
  return parseUntilSlugs(raw)
}

const parseTimeoutMs = (raw: unknown): Either.Either<number, WaitRequestError> => {
  if (raw === undefined) return Either.right(WAIT_TIMEOUT_DEFAULT_MS)
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 1 || raw > WAIT_TIMEOUT_MAX_MS) {
    return Either.left(
      badTimeout(`timeoutMs must be an integer between 1 and ${WAIT_TIMEOUT_MAX_MS}`),
    )
  }
  return Either.right(raw)
}

// What a timed-out wait reports having waited.
//
// Not simply the measured elapsed time, because a timeout is a fact about the
// request as well as a measurement: the wait was asked to honour `requestedMs`
// and it did, so reporting less than that describes a wait that never happened.
// It can nonetheless come out lower — a runtime schedules its timers against a
// monotonic clock and the elapsed reading is taken separately, so a timer that
// fires a fraction of a millisecond "early" against the reading clock truncates
// to one below. CI caught exactly that: a `timeoutMs: 50` wait reported
// `waitedMs: 49`.
//
// The floor is the caller's own `requestedMs`, not a tolerance — a real
// overshoot (a busy event loop delivering the timer late) is still reported in
// full, which is the only part of this number a caller can act on.
export const timeoutWaitedMs = ({
  requestedMs,
  elapsedMs,
}: {
  readonly requestedMs: number
  readonly elapsedMs: number
}): number => Math.max(requestedMs, Math.round(elapsedMs))

// --- Output patterns ---------------------------------------------------------

// Deliberately NOT a regex — see `OUTPUT_PATTERN_MAX_CHARS` in
// shared/src/wait.ts for the ReDoS argument the cap and the literal-only rule
// rest on, and why `anchor` covers what a regex was wanted for here.

const badPattern = (message: string): WaitRequestError => ({ _tag: "BadPattern", message })

// Accepts either the shorthand — a bare string, meaning "this substring
// anywhere" — or the explicit `{ text, anchor? }` object.
const parseUntilOutput = (
  raw: unknown,
): Either.Either<OutputPattern | undefined, WaitRequestError> => {
  if (raw === undefined) return Either.right(undefined)
  const source = typeof raw === "string" ? { text: raw } : raw
  if (!isPlainObject(source)) {
    return Either.left(badPattern("untilOutput must be a string or an object with a text field"))
  }
  const { text, anchor } = source
  if (!isNonEmptyString(text)) {
    return Either.left(badPattern("untilOutput text must be a non-empty string"))
  }
  if (text.length > OUTPUT_PATTERN_MAX_CHARS) {
    return Either.left(
      badPattern(`untilOutput text is capped at ${OUTPUT_PATTERN_MAX_CHARS} characters`),
    )
  }
  if (anchor !== undefined && !isOutputAnchor(anchor)) {
    return Either.left(badPattern(`untilOutput anchor must be one of ${OUTPUT_ANCHORS.join(", ")}`))
  }
  return Either.right({ text, anchor: anchor ?? DEFAULT_OUTPUT_ANCHOR })
}

const lineMatches = ({
  pattern,
  line,
}: {
  readonly pattern: OutputPattern
  readonly line: string
}): boolean => {
  // An anchored pattern compares against the TRIMMED line: a real dump pads the
  // empty prompt line with U+00A0 and right-pads rows to the viewport width
  // (see terminal-state.core.ts's prompt-resting row, which was fixed for
  // exactly this), so anchoring to the raw line would never fire on a live
  // screen.
  const trimmed = line.trim()
  if (pattern.anchor === "line") return trimmed === pattern.text
  if (pattern.anchor === "line-start") return trimmed.startsWith(pattern.text)
  if (pattern.anchor === "line-end") return trimmed.endsWith(pattern.text)
  return line.includes(pattern.text)
}

// Does this screen contain the pattern? Pure string work over already
// ANSI-stripped text — the terminal slice computes the plain text once per dump
// and the shell hands that in.
//
// Returns the matched LINE rather than a boolean so the outcome can quote what
// it saw, the same instinct as a classification's `evidence`: a caller that
// asked for "Do you want to proceed?" gets back the line it actually appeared on.
export const matchOutputPattern = ({
  pattern,
  text,
}: {
  readonly pattern: OutputPattern
  readonly text: string
}): string | undefined => {
  for (const line of text.split("\n")) {
    if (lineMatches({ pattern, line })) return line.trim()
  }
  return undefined
}

// Validates an untrusted JSON body for POST /:id/wait (and the optional
// `wait` object nested in POST /:id/send).
//
// `until` and `untilOutput` are independent conditions and at least one must be
// present. Supplying both is allowed and means "whichever happens first" —
// consistent with `via: "either"`, and the genuinely useful case ("wait for the
// permission prompt, or for the session to die, whichever comes first"). The
// outcome says which one fired.
export const parseWaitRequest = (raw: unknown): Either.Either<WaitRequest, WaitRequestError> => {
  if (!isPlainObject(raw)) return Either.left(badUntil("wait request body must be an object"))
  const untilOutput = parseUntilOutput(raw.untilOutput)
  if (Either.isLeft(untilOutput)) return Either.left(untilOutput.left)
  const until = parseUntil({
    raw: raw.until,
    outputRequested: untilOutput.right !== undefined,
  })
  if (Either.isLeft(until)) return Either.left(until.left)
  const timeoutMs = parseTimeoutMs(raw.timeoutMs)
  if (Either.isLeft(timeoutMs)) return Either.left(timeoutMs.left)
  const via = parseVia(raw.via)
  if (Either.isLeft(via)) return Either.left(via.left)
  return Either.right({
    until: until.right,
    untilOutput: untilOutput.right,
    timeoutMs: timeoutMs.right,
    via: via.right,
  })
}

// --- screen -> session vocabulary -------------------------------------------

// The terminal classifier's four slugs, expressed in the vocabulary a wait's
// `until` is written in. Three of them are the same word in both languages;
// `unknown` deliberately maps to nothing — an unclassified screen is the
// absence of evidence, not evidence of a state, so it must never satisfy a
// wait. Anything not in this table (a session-only slug like `done`, a future
// classifier slug) is treated the same way.
const TERMINAL_TO_SESSION: Readonly<Record<string, SessionStateSlug>> = {
  working: "working",
  blocked: "blocked",
  idle: "idle",
}

export const sessionSlugFromTerminalState = (state: string): SessionStateSlug | undefined =>
  TERMINAL_TO_SESSION[state]

// --- Occupant-pinned evaluation ---------------------------------------------

export type WaitTarget = {
  readonly short: string
  readonly sessionId: string | undefined
}

export type WaitEvent =
  | {
      readonly kind: "state"
      readonly short: string
      readonly sessionId: string | undefined
      readonly state: SessionStateSlug
    }
  | { readonly kind: "removed"; readonly short: string }
  // A screen classification, already translated into the session vocabulary.
  // It carries no `sessionId` — a screen belongs to the zellij session, not to
  // whichever occupant currently holds the short — which is why the occupant
  // pin below is only ever evaluated for a `state` event.
  | { readonly kind: "terminal"; readonly short: string; readonly state: SessionStateSlug }

// `via` on Satisfied answers "which observation settled this", so a caller can
// tell a supervisor-confirmed finish from one the screen inferred.
export type WaitDecision =
  | {
      readonly _tag: "Satisfied"
      readonly state: SessionStateSlug
      readonly via: "supervisor" | "screen"
    }
  | { readonly _tag: "OccupantChanged" }
  | { readonly _tag: "Removed" }
  | { readonly _tag: "Ignore" }

const satisfiedIfAwaited = ({
  request,
  state,
  via,
}: {
  readonly request: WaitRequest
  readonly state: SessionStateSlug
  readonly via: "supervisor" | "screen"
}): WaitDecision =>
  request.until.includes(state) ? { _tag: "Satisfied", state, via } : { _tag: "Ignore" }

const isOccupantSwap = ({
  target,
  eventSessionId,
}: {
  readonly target: WaitTarget
  readonly eventSessionId: string | undefined
}): boolean =>
  target.sessionId !== undefined &&
  eventSessionId !== undefined &&
  target.sessionId !== eventSessionId

const evaluateSupervisorEvent = ({
  request,
  target,
  event,
}: {
  readonly request: WaitRequest
  readonly target: WaitTarget
  readonly event: Extract<WaitEvent, { kind: "state" }>
}): WaitDecision => {
  if (!viaAllowsSupervisor(request.via)) return { _tag: "Ignore" }
  if (isOccupantSwap({ target, eventSessionId: event.sessionId })) {
    return { _tag: "OccupantChanged" }
  }
  return satisfiedIfAwaited({ request, state: event.state, via: "supervisor" })
}

const evaluateTerminalEvent = ({
  request,
  event,
}: {
  readonly request: WaitRequest
  readonly event: Extract<WaitEvent, { kind: "terminal" }>
}): WaitDecision => {
  if (!viaAllowsScreen(request.via)) return { _tag: "Ignore" }
  return satisfiedIfAwaited({ request, state: event.state, via: "screen" })
}

// Order matters: a short mismatch is checked first (nothing else applies to
// events about another session), then removal — which settles the wait under
// every `via`, because a deleted session is not an observation about state but
// the end of the thing being observed — and only then does the event's own
// source decide whether this `via` admits it.
export const evaluateWaitEvent = ({
  request,
  target,
  event,
}: {
  readonly request: WaitRequest
  readonly target: WaitTarget
  readonly event: WaitEvent
}): WaitDecision => {
  if (event.short !== target.short) return { _tag: "Ignore" }
  if (event.kind === "removed") return { _tag: "Removed" }
  if (event.kind === "terminal") return evaluateTerminalEvent({ request, event })
  return evaluateSupervisorEvent({ request, target, event })
}

// --- Screen-text observation -------------------------------------------------
//
// A screen observation arrives on its own channel, not on the SSE bus: it
// carries the whole (bounded) pane text, and the bus is the stream every
// browser is subscribed to. See sessions-wait.io.ts's port.

export type ScreenObservation = {
  readonly scope: string
  readonly short: string
  readonly text: string // ANSI already stripped by the terminal slice
}

export type ScreenDecision =
  | { readonly _tag: "OutputMatched"; readonly matched: string }
  | { readonly _tag: "Ignore" }

// Note what does NOT appear here: `via`. `via` governs how a session's STATE is
// observed, and `untilOutput` is not a statement about state — it is a
// statement about bytes on a screen. Gating it on `via` would make
// `{ untilOutput, via: "supervisor" }` a request that can never be satisfied,
// which is a trap rather than a safeguard.
export const evaluateScreenObservation = ({
  request,
  target,
  observation,
}: {
  readonly request: WaitRequest
  readonly target: WaitTarget
  readonly observation: ScreenObservation
}): ScreenDecision => {
  if (request.untilOutput === undefined) return { _tag: "Ignore" }
  // Only the session scope names a roster short; the global, orchestrator and
  // project terminals cannot be about this wait's target.
  if (observation.scope !== "session") return { _tag: "Ignore" }
  if (observation.short !== target.short) return { _tag: "Ignore" }
  const matched = matchOutputPattern({ pattern: request.untilOutput, text: observation.text })
  return matched === undefined ? { _tag: "Ignore" } : { _tag: "OutputMatched", matched }
}

export type InitialDecision =
  | {
      readonly _tag: "Satisfied"
      readonly state: SessionStateSlug
      readonly via: "supervisor" | "screen"
    }
  | { readonly _tag: "NotFound" }
  | { readonly _tag: "Pending" }

const satisfiedInitial = ({
  request,
  state,
  via,
}: {
  readonly request: WaitRequest
  readonly state: SessionStateSlug | undefined
  readonly via: "supervisor" | "screen"
}): InitialDecision | undefined =>
  state !== undefined && request.until.includes(state)
    ? { _tag: "Satisfied", state, via }
    : undefined

// `terminal` is the CURRENT screen classification for this short, already
// mapped into the session vocabulary by the shell (undefined when nothing has
// classified it, or when the classification was `unknown`). Consulting it here
// is what stops a `via: screen` wait against an already-blocked pane from
// hanging for the whole timeout: the transition it would have waited for
// happened before the wait started.
export const decideInitial = ({
  request,
  current,
  terminal,
}: {
  readonly request: WaitRequest
  readonly current: { readonly state: SessionStateSlug } | undefined
  readonly terminal: SessionStateSlug | undefined
}): InitialDecision => {
  if (!current) return { _tag: "NotFound" }
  const supervisor = viaAllowsSupervisor(request.via)
    ? satisfiedInitial({ request, state: current.state, via: "supervisor" })
    : undefined
  const screen = viaAllowsScreen(request.via)
    ? satisfiedInitial({ request, state: terminal, via: "screen" })
    : undefined
  return supervisor ?? screen ?? { _tag: "Pending" }
}

// --- SSE-bus payload decoders ------------------------------------------------
//
// `sse-bus` events carry `unknown` data; these turn a raw `session.state` /
// `session.removed` payload into a `WaitEvent`, or `undefined` on anything
// unexpected — never a cast, never a throw.

export const decodeSessionStateEvent = (payload: unknown): WaitEvent | undefined => {
  if (!isPlainObject(payload)) return undefined
  const { short, sessionId, state } = payload
  if (!isNonEmptyString(short)) return undefined
  if (typeof state !== "string" || !isSessionStateSlug(state)) return undefined
  return {
    kind: "state",
    short,
    sessionId: typeof sessionId === "string" ? sessionId : undefined,
    state,
  }
}

export const decodeSessionRemovedEvent = (payload: unknown): WaitEvent | undefined => {
  if (!isPlainObject(payload)) return undefined
  const { short } = payload
  if (!isNonEmptyString(short)) return undefined
  return { kind: "removed", short }
}

// A `terminal.state` record, whose vocabulary is the terminal slice's, not
// this one's: it is keyed `scope`/`id` rather than `short`, and its `state` is
// a screen classification. Only `scope === "session"` records name a roster
// short (the poller also classifies the global, orchestrator and project
// terminals), so the rest are dropped rather than matched against a target
// they cannot be about. An unmappable state — including `unknown` — yields no
// event at all, so it can never satisfy a wait.
export const decodeTerminalStateEvent = (payload: unknown): WaitEvent | undefined => {
  if (!isPlainObject(payload)) return undefined
  const { scope, id, state } = payload
  if (scope !== "session") return undefined
  if (!isNonEmptyString(id)) return undefined
  if (typeof state !== "string") return undefined
  const mapped = sessionSlugFromTerminalState(state)
  if (mapped === undefined) return undefined
  return { kind: "terminal", short: id, state: mapped }
}
