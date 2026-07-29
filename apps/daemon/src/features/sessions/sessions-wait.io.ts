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
  readonly at: string
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

export type WaitOutcome =
  | {
      readonly _tag: "Satisfied"
      readonly state: SessionStateSlug
      readonly via: "supervisor" | "screen"
      readonly waitedMs: number
    }
  | { readonly _tag: "Timeout"; readonly waitedMs: number }
  | { readonly _tag: "OccupantChanged" }
  | { readonly _tag: "Removed" }
  | { readonly _tag: "NotFound" }

export type SessionWaitApi = {
  readonly wait: (input: {
    readonly short: string
    readonly request: WaitRequest
    readonly pinnedSessionId?: string | undefined
    // Absent means "no screen facts available", which only matters for a
    // `via: screen`/`either` request — a supervisor-only wait never asks.
    readonly readTerminalState?: TerminalStateReader | undefined
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

// Subscribes to the SSE bus and races it against `request.timeoutMs`. Uses
// Effect.async so the fiber can be interrupted (client disconnect, server
// shutdown) without leaking the subscription or the timer — the register
// function's return value is run as the interruption finalizer.
const waitForEvent = ({
  target,
  request,
  startedAt,
}: {
  readonly target: WaitTarget
  readonly request: WaitRequest
  readonly startedAt: number
}): Effect.Effect<WaitOutcome> =>
  Effect.async<WaitOutcome>((resume) => {
    let settled = false
    let timer: ReturnType<typeof setTimeout>
    let unsubscribe: () => void

    const settle = (outcome: WaitOutcome): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      unsubscribe()
      resume(Effect.succeed(outcome))
    }

    unsubscribe = sseBus.subscribe((event) => {
      const outcome = outcomeFromBusEvent({ target, request, event, startedAt })
      if (outcome) settle(outcome)
    })
    timer = setTimeout(() => {
      settle({ _tag: "Timeout", waitedMs: Date.now() - startedAt })
    }, request.timeoutMs)

    return Effect.sync(() => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      unsubscribe()
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

const buildApi = (registry: SessionRegistryApi): SessionWaitApi => ({
  wait: ({ short, request, pinnedSessionId, readTerminalState }) =>
    Effect.gen(function* () {
      const startedAt = Date.now()
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
      return yield* waitForEvent({ target, request, startedAt })
    }),
})

export const SessionWaitIoLive: Layer.Layer<SessionWaitIo, never, SessionRegistry> = Layer.effect(
  SessionWaitIo,
  Effect.map(SessionRegistry, buildApi),
)
