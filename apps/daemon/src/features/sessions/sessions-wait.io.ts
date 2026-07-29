// Server-owned waits on session state: subscribe to the SSE bus and resolve
// once the pure core decides the occupant-pinned request is Satisfied /
// OccupantChanged / Removed, or the timeout fires. No polling — the daemon
// already publishes every state transition on `sseBus`.

import { Context, Effect, Layer } from "effect"
import { sseBus } from "../../platform/sse-bus"
import type { SessionStateSlug } from "./sessions.core"
import { SessionRegistry, type SessionRegistryApi } from "./sessions.io"
import {
  decideInitial,
  decodeSessionRemovedEvent,
  decodeSessionStateEvent,
  decodeTerminalStateEvent,
  evaluateScreenObservation,
  evaluateWaitEvent,
  type InitialScreenReading,
  screenLook,
  sessionSlugFromTerminalState,
  type WaitEvent,
  type WaitRequest,
  type WaitTarget,
} from "./sessions-wait.core"

// The terminal slice's screen-derived facts for one terminal, as plain data.
// Structurally what terminal.routes.ts's `readTerminalState` door returns —
// declared here rather than imported so the sessions slice never reaches into
// a sibling slice's internals (modular monolith). The composition root
// (api.ts) is what connects the two.
export type TerminalStateFacts = {
  readonly state: string
  readonly matcher: string | undefined
  readonly evidence: string | undefined
  // The record's two ISO stamps: when the pane's screen was last read, and when
  // the classification last changed.
  //
  // A wait reads `screenReadAt` and only that one — it is what says how fresh
  // this reading is, and the initial check refuses to settle a wait from a
  // reading older than `SCREEN_READING_MAX_AGE_MS`. `stateChangedAt` is dwell,
  // which says nothing about trustworthiness (a pane resting all morning is read
  // every pass), so no wait decision may ever be taken on it. It is part of the
  // door's shape because the same reader serves `GET /sessions/:id/explain`,
  // which reports both ages.
  readonly screenReadAt: string
  readonly stateChangedAt: string
}

// Injected port, not a Tag: the terminal slice's state map is written by the
// WS classifier tap and the unattended poller inside terminal.routes.ts, which
// itself imports platform/runtime — so a Layer dependency here would close an
// import cycle through the very runtime that provides it. api.ts passes the
// real reader in at each call site instead.
export type TerminalStateReader = (input: {
  readonly scope: string
  readonly id: string
}) => TerminalStateFacts | undefined

// The terminal slice's screen-text channel, as a port. Screen text deliberately
// does NOT travel on `sseBus` (that stream reaches every connected browser —
// see terminal.routes.ts's subscribeTerminalScreens), so an output wait
// subscribes here instead of to the bus.
//
// `enabled` is the poller's own armed/disarmed state. An output wait resolves
// off the poller's passes and nothing else, so when polling is off such a wait
// could only ever time out; the caller is told so up front instead.
export type TerminalScreensPort = {
  readonly enabled: () => boolean
  readonly subscribe: (
    observer: (screen: {
      readonly scope: string
      readonly id: string
      readonly text: string
    }) => void,
  ) => () => void
  // "Take a pass now if the last one is stale." Called once, at the start of any
  // wait that admits screen evidence, so the reading the initial check judges is
  // as current as the daemon can cheaply make it — this daemon has lost its whole
  // timer subsystem on a long uptime before, and a wait that trusted only the
  // interval would then be judging a reading nothing was refreshing.
  //
  // Safe to call per wait because the poller's own `refreshIfStale` is bounded
  // three ways and this port must keep it that way: it is inert when polling is
  // disabled, inert when the last pass is younger than the interval, and
  // overlapping calls share the single in-flight pass. So N concurrent waits cost
  // at most one pass per interval, not N passes — a wait must never turn into two
  // `zellij` spawns of its own.
  //
  // Fire-and-forget by construction (returns void): the pass lands after this
  // wait has subscribed, so its result arrives as a `terminal.state` event rather
  // than by blocking the request on a subprocess.
  readonly refreshIfStale: () => void
}

export type WaitOutcome =
  | {
      readonly _tag: "Satisfied"
      readonly state: SessionStateSlug
      readonly via: "supervisor" | "screen"
      readonly waitedMs: number
    }
  // An `untilOutput` pattern appeared on the session's screen. Separate from
  // Satisfied because there is no session state to report: a pattern match is a
  // statement about bytes, not about a slug. `matched` is the line it was found
  // on, so the caller can see what fired.
  | { readonly _tag: "OutputMatched"; readonly matched: string; readonly waitedMs: number }
  | { readonly _tag: "Timeout"; readonly waitedMs: number }
  | { readonly _tag: "OccupantChanged" }
  | { readonly _tag: "Removed" }
  | { readonly _tag: "NotFound" }
  // The request asked for an output pattern, but screen polling is disabled
  // (`PID_TERMINAL_POLL_MS` unset or non-positive), so nothing will ever read
  // the pane. Refused up front rather than left to time out.
  | { readonly _tag: "ScreenPollingDisabled" }

export type SessionWaitApi = {
  readonly wait: (input: {
    readonly short: string
    readonly request: WaitRequest
    readonly pinnedSessionId?: string | undefined
    // Absent means "no screen facts available", which only matters for a
    // `via: screen`/`either` request — a supervisor-only wait never asks.
    readonly readTerminalState?: TerminalStateReader | undefined
    // Absent means no screen-text channel is wired, which an `untilOutput`
    // request is refused for on the same grounds as a disabled poller.
    readonly terminalScreens?: TerminalScreensPort | undefined
  }) => Effect.Effect<WaitOutcome>
}

export class SessionWaitIo extends Context.Tag("SessionWaitIo")<SessionWaitIo, SessionWaitApi>() {}

type BusEvent = { readonly type: string; readonly data: unknown }

const decodeBusEvent = (event: BusEvent): WaitEvent | undefined => {
  if (event.type === "session.state") return decodeSessionStateEvent(event.data)
  if (event.type === "session.removed") return decodeSessionRemovedEvent(event.data)
  // Published by terminal.routes.ts's single writer for every screen
  // classification change, attended or polled. The pure core drops the scopes
  // and states that cannot be about a roster short.
  if (event.type === "terminal.state") return decodeTerminalStateEvent(event.data)
  return undefined
}

// Turns one bus event into a settleable WaitOutcome, or `undefined` when the
// wait should keep listening (an Ignore decision, or a payload the decoders
// couldn't make sense of).
const outcomeFromBusEvent = ({
  target,
  request,
  event,
  startedAt,
}: {
  readonly target: WaitTarget
  readonly request: WaitRequest
  readonly event: BusEvent
  readonly startedAt: number
}): WaitOutcome | undefined => {
  const waitEvent = decodeBusEvent(event)
  if (!waitEvent) return undefined
  const decision = evaluateWaitEvent({ request, target, event: waitEvent })
  if (decision._tag === "Ignore") return undefined
  if (decision._tag === "Satisfied") {
    return {
      _tag: "Satisfied",
      state: decision.state,
      via: decision.via,
      waitedMs: Date.now() - startedAt,
    }
  }
  return decision
}

// One screen observation into a settleable outcome, or `undefined` to keep
// listening. Mirrors outcomeFromBusEvent for the other channel.
const outcomeFromScreen = ({
  target,
  request,
  screen,
  startedAt,
}: {
  readonly target: WaitTarget
  readonly request: WaitRequest
  readonly screen: { readonly scope: string; readonly id: string; readonly text: string }
  readonly startedAt: number
}): WaitOutcome | undefined => {
  const decision = evaluateScreenObservation({
    request,
    target,
    observation: { scope: screen.scope, short: screen.id, text: screen.text },
  })
  if (decision._tag === "Ignore") return undefined
  return { _tag: "OutputMatched", matched: decision.matched, waitedMs: Date.now() - startedAt }
}

// Subscribes to the SSE bus — and, when the request carries a pattern, to the
// terminal slice's screen-text channel — and races both against
// `request.timeoutMs`. Uses Effect.async so the fiber can be interrupted (client
// disconnect, server shutdown) without leaking either subscription or the timer:
// the register function's return value is run as the interruption finalizer.
const waitForEvent = ({
  target,
  request,
  startedAt,
  terminalScreens,
}: {
  readonly target: WaitTarget
  readonly request: WaitRequest
  readonly startedAt: number
  readonly terminalScreens: TerminalScreensPort | undefined
}): Effect.Effect<WaitOutcome> =>
  Effect.async<WaitOutcome>((resume) => {
    let settled = false
    let timer: ReturnType<typeof setTimeout>
    let unsubscribe: () => void
    // No-op until the pattern path actually subscribes, so `release` below can
    // stay branch-free.
    let unsubscribeScreens: () => void = () => {}

    const settle = (outcome: WaitOutcome): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      unsubscribe()
      unsubscribeScreens()
      resume(Effect.succeed(outcome))
    }

    unsubscribe = sseBus.subscribe((event) => {
      const outcome = outcomeFromBusEvent({ target, request, event, startedAt })
      if (outcome) settle(outcome)
    })
    if (request.untilOutput !== undefined && terminalScreens !== undefined) {
      unsubscribeScreens = terminalScreens.subscribe((screen) => {
        const outcome = outcomeFromScreen({ target, request, screen, startedAt })
        if (outcome) settle(outcome)
      })
    }
    timer = setTimeout(() => {
      settle({ _tag: "Timeout", waitedMs: Date.now() - startedAt })
    }, request.timeoutMs)

    return Effect.sync(() => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      unsubscribe()
      unsubscribeScreens()
    })
  })

// How long ago that reading's pane was actually read, in ms — the impure half of
// the freshness judgement (`Date.parse` + the clock live here; the ceiling itself
// is pure, in `isScreenReadingFresh`).
//
// `screenReadAt`, never `stateChangedAt`: a pane resting since this morning is
// re-read every poll pass, so the change time would report it as hours old and
// throw away a current reading — the exact confusion this pair of stamps was
// split to end. A stamp that will not parse yields `undefined`, which the core
// treats as "not fresh".
const screenReadAgeMs = ({
  readAt,
  now,
}: {
  readonly readAt: string
  readonly now: number
}): number | undefined => {
  const parsed = Date.parse(readAt)
  return Number.isNaN(parsed) ? undefined : Math.max(0, now - parsed)
}

// The screen's stored reading for one session short, translated into the session
// vocabulary and carrying its own age — `undefined` when no reader was injected,
// nothing has classified this terminal yet, or the classification was `unknown`.
//
// The age travels with the state because `decideInitial` refuses to settle a wait
// from a reading it cannot date or that is past the ceiling.
const currentScreenReading = ({
  short,
  readTerminalState,
  now,
}: {
  readonly short: string
  readonly readTerminalState: TerminalStateReader | undefined
  readonly now: number
}): InitialScreenReading | undefined => {
  const facts = readTerminalState?.({ scope: "session", id: short })
  if (!facts) return undefined
  const state = sessionSlugFromTerminalState(facts.state)
  if (state === undefined) return undefined
  return { state, readAgeMs: screenReadAgeMs({ readAt: facts.screenReadAt, now }) }
}

// An output pattern can only ever be satisfied by a poller pass, so a request
// that carries one is refused when there is no armed poller to produce them.
// Silence for the full timeout would leave the caller unable to tell "not yet"
// from "never".
const screenPollingUnavailable = ({
  request,
  terminalScreens,
}: {
  readonly request: WaitRequest
  readonly terminalScreens: TerminalScreensPort | undefined
}): boolean => {
  if (request.untilOutput === undefined) return false
  return terminalScreens === undefined || !terminalScreens.enabled()
}

// Does anything about this request depend on the screen? `untilOutput` resolves
// off poller passes; `via: screen`/`either` may be settled by a classification.
// Either way the pane wants reading, so a stale poller is worth nudging — and a
// supervisor-only wait must not nudge it, because it would be paying subprocess
// budget for evidence it is not allowed to use.
const requestUsesScreen = (request: WaitRequest): boolean =>
  request.untilOutput !== undefined || request.via !== "supervisor"

const buildApi = (registry: SessionRegistryApi): SessionWaitApi => ({
  wait: ({ short, request, pinnedSessionId, readTerminalState, terminalScreens }) =>
    Effect.gen(function* () {
      const startedAt = Date.now()
      if (screenPollingUnavailable({ request, terminalScreens })) {
        return { _tag: "ScreenPollingDisabled" as const }
      }
      // Nudge the poller BEFORE reading the stored classification, so the reading
      // the ceiling judges is the freshest the daemon can cheaply offer. Bounded
      // by the port's own contract (inert when disabled or recently passed,
      // coalesced when concurrent), and fire-and-forget: the pass's own result
      // reaches this wait as a `terminal.state` event after it subscribes below.
      if (requestUsesScreen(request)) terminalScreens?.refreshIfStale()
      // getOne() also drives the registry's refresh-on-read pass — needed so
      // a wait started right after a state change observes it immediately
      // rather than depending on the (occasionally timer-starved) poll loop.
      const current = yield* Effect.promise(() => registry.getOne(short))
      const terminal = currentScreenReading({ short, readTerminalState, now: Date.now() })
      const initial = decideInitial({ request, current, terminal })
      if (initial._tag === "NotFound") return { _tag: "NotFound" as const }
      if (initial._tag === "Satisfied") {
        return {
          _tag: "Satisfied" as const,
          state: initial.state,
          via: initial.via,
          waitedMs: 0,
        }
      }
      const target: WaitTarget = { short, sessionId: pinnedSessionId ?? current?.sessionId }
      const outcome = yield* waitForEvent({ target, request, startedAt, terminalScreens })
      if (outcome._tag !== "Timeout") return outcome
      // One last look at the stored reading before giving up. A poller pass that
      // re-read the pane and found the same classification freshened
      // `screenReadAt` without publishing anything — by design — so a wait that
      // declined a stale reading and then watched that reading be CONFIRMED had
      // nothing to hear. See `screenLook` for why this is screen-only.
      return finalScreenLook({ request, short, readTerminalState, startedAt }) ?? outcome
    }),
})

// The last look, as an outcome or `undefined` to keep the timeout. Reads the map
// once — no I/O, no extra subprocess — and reports the elapsed time honestly:
// `waitedMs` is how long the caller actually waited, not zero, because this
// reading was confirmed at the end of the wait rather than at its start.
const finalScreenLook = ({
  request,
  short,
  readTerminalState,
  startedAt,
}: {
  readonly request: WaitRequest
  readonly short: string
  readonly readTerminalState: TerminalStateReader | undefined
  readonly startedAt: number
}): WaitOutcome | undefined => {
  const decision = screenLook({
    request,
    terminal: currentScreenReading({ short, readTerminalState, now: Date.now() }),
  })
  if (decision._tag !== "Satisfied") return undefined
  return {
    _tag: "Satisfied",
    state: decision.state,
    via: decision.via,
    waitedMs: Date.now() - startedAt,
  }
}

export const SessionWaitIoLive: Layer.Layer<SessionWaitIo, never, SessionRegistry> = Layer.effect(
  SessionWaitIo,
  Effect.map(SessionRegistry, buildApi),
)
