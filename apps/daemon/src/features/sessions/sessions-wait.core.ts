// Pure decision logic for server-owned waits on session state. No I/O — the
// SSE subscription, clock and timeout live in sessions-wait.io.ts; this file
// only turns already-decoded values into decisions.

import { Either } from "effect"
import { isSessionStateSlug, type SessionStateSlug } from "./sessions.core"

export const WAIT_TIMEOUT_DEFAULT_MS = 30_000
export const WAIT_TIMEOUT_MAX_MS = 600_000

export type WaitRequest = {
  readonly until: ReadonlyArray<SessionStateSlug>
  readonly timeoutMs: number
}

export type WaitRequestError = {
  readonly _tag: "BadUntil" | "BadTimeout"
  readonly message: string
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)

const isNonEmptyString = (v: unknown): v is string => typeof v === "string" && v.length > 0

const badUntil = (message: string): WaitRequestError => ({ _tag: "BadUntil", message })

const badTimeout = (message: string): WaitRequestError => ({ _tag: "BadTimeout", message })

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
  return Either.right({ until: until.right, timeoutMs: timeoutMs.right })
}

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

export type WaitDecision =
  | { readonly _tag: "Satisfied"; readonly state: SessionStateSlug }
  | { readonly _tag: "OccupantChanged" }
  | { readonly _tag: "Removed" }
  | { readonly _tag: "Ignore" }

// Order matters: a short mismatch is checked first (nothing else applies to
// events about another session), removal short-circuits before the pin check
// (a removed session has no occupant to compare), then the pin, then the
// awaited-states membership.
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
  if (
    target.sessionId !== undefined &&
    event.sessionId !== undefined &&
    target.sessionId !== event.sessionId
  ) {
    return { _tag: "OccupantChanged" }
  }
  if (request.until.includes(event.state)) return { _tag: "Satisfied", state: event.state }
  return { _tag: "Ignore" }
}

export type InitialDecision =
  | { readonly _tag: "Satisfied"; readonly state: SessionStateSlug }
  | { readonly _tag: "NotFound" }
  | { readonly _tag: "Pending" }

export const decideInitial = ({
  request,
  current,
}: {
  readonly request: WaitRequest
  readonly current: { readonly state: SessionStateSlug } | undefined
}): InitialDecision => {
  if (!current) return { _tag: "NotFound" }
  if (request.until.includes(current.state)) return { _tag: "Satisfied", state: current.state }
  return { _tag: "Pending" }
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
