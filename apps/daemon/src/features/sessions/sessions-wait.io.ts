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
  // the classification last changed. A wait reads neither — `decideInitial` asks
  // only what the screen says — but they are part of the door's shape, and the
  // same reader serves `GET /sessions/:id/explain`, which reports both.
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

// The screen's current reading for one session short, already translated into
// the session vocabulary — `undefined` when no reader was injected, nothing has
// classified this terminal yet, or the classification was `unknown`.
const currentScreenSlug = ({
  short,
  readTerminalState,
}: {
  readonly short: string
  readonly readTerminalState: TerminalStateReader | undefined
}): SessionStateSlug | undefined => {
  const facts = readTerminalState?.({ scope: "session", id: short })
  return facts ? sessionSlugFromTerminalState(facts.state) : undefined
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

const buildApi = (registry: SessionRegistryApi): SessionWaitApi => ({
  wait: ({ short, request, pinnedSessionId, readTerminalState, terminalScreens }) =>
    Effect.gen(function* () {
      const startedAt = Date.now()
      if (screenPollingUnavailable({ request, terminalScreens })) {
        return { _tag: "ScreenPollingDisabled" as const }
      }
      // getOne() also drives the registry's refresh-on-read pass — needed so
      // a wait started right after a state change observes it immediately
      // rather than depending on the (occasionally timer-starved) poll loop.
      const current = yield* Effect.promise(() => registry.getOne(short))
      const terminal = currentScreenSlug({ short, readTerminalState })
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
      return yield* waitForEvent({ target, request, startedAt, terminalScreens })
    }),
})

export const SessionWaitIoLive: Layer.Layer<SessionWaitIo, never, SessionRegistry> = Layer.effect(
  SessionWaitIo,
  Effect.map(SessionRegistry, buildApi),
)
