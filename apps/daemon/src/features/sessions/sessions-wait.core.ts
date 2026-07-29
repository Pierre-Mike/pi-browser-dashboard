// Pure decision logic for server-owned waits on session state. No I/O — the
// SSE subscription, clock and timeout live in sessions-wait.io.ts; this file
// only turns already-decoded values into decisions.

import { Either } from "effect"
import { isSessionStateSlug, type SessionStateSlug } from "./sessions.core"

export const WAIT_TIMEOUT_DEFAULT_MS = 30_000
export const WAIT_TIMEOUT_MAX_MS = 600_000

// Which observation of the session is allowed to settle the wait.
//
// `supervisor` is what a wait has always meant: the state.json the supervisor
// writes, republished as `session.state`. `screen` is the terminal classifier's
// reading of the actual pane (see features/terminal/terminal-state.core.ts) —
// the state that cannot lie about a session whose state.json went quiet hours
// ago. `either` settles on whichever arrives first, and says which one did.
export type WaitVia = "supervisor" | "screen" | "either"

// Exported as the single authority on the `via` vocabulary: the request
// parser validates against it, and platform/agent-skill.test.ts asserts the
// served agent doc documents exactly these three and no others.
export const WAIT_VIA_VALUES: ReadonlyArray<WaitVia> = ["supervisor", "screen", "either"]

export type WaitRequest = {
  readonly until: ReadonlyArray<SessionStateSlug>
  readonly timeoutMs: number
  readonly via: WaitVia
}

export type WaitRequestError = {
  readonly _tag: "BadUntil" | "BadTimeout" | "BadVia"
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

const isWaitVia = (raw: unknown): raw is WaitVia =>
  typeof raw === "string" && (WAIT_VIA_VALUES as ReadonlyArray<string>).includes(raw)

// Absent means `supervisor`: every caller written before the screen became a
// wait source keeps exactly the semantics it was written against.
const parseVia = (raw: unknown): Either.Either<WaitVia, WaitRequestError> => {
  if (raw === undefined) return Either.right("supervisor")
  if (!isWaitVia(raw)) {
    return Either.left({
      _tag: "BadVia",
      message: `via must be one of ${WAIT_VIA_VALUES.join(", ")}`,
    })
  }
  return Either.right(raw)
}

const parseUntil = (
  raw: unknown,
): Either.Either<ReadonlyArray<SessionStateSlug>, WaitRequestError> => {
  if (!Array.isArray(raw) || raw.length === 0) {
    return Either.left(badUntil("until must be a non-empty array of session states"))
  }
  const slugs: SessionStateSlug[] = []
  for (const item of raw) {
    if (typeof item !== "string" || !isSessionStateSlug(item)) {
      return Either.left(badUntil(`until contains an unknown state: ${JSON.stringify(item)}`))
    }
    if (!slugs.includes(item)) slugs.push(item)
  }
  return Either.right(slugs)
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

// Validates an untrusted JSON body for POST /:id/wait (and the optional
// `wait` object nested in POST /:id/send).
export const parseWaitRequest = (raw: unknown): Either.Either<WaitRequest, WaitRequestError> => {
  if (!isPlainObject(raw)) return Either.left(badUntil("wait request body must be an object"))
  const until = parseUntil(raw.until)
  if (Either.isLeft(until)) return Either.left(until.left)
  const timeoutMs = parseTimeoutMs(raw.timeoutMs)
  if (Either.isLeft(timeoutMs)) return Either.left(timeoutMs.left)
  const via = parseVia(raw.via)
  if (Either.isLeft(via)) return Either.left(via.left)
  return Either.right({ until: until.right, timeoutMs: timeoutMs.right, via: via.right })
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
