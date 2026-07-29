import { afterEach, describe, expect, it } from "bun:test"
import { Effect, Layer, ManagedRuntime } from "effect"
import { sseBus } from "../../platform/sse-bus"
import type { SessionState } from "./sessions.core"
import { SessionRegistry } from "./sessions.io"
import { makeSessionState as makeSession } from "./sessions.testFixtures"
import type { WaitRequest } from "./sessions-wait.core"
import {
  SessionWaitIo,
  SessionWaitIoLive,
  type TerminalStateReader,
  type WaitOutcome,
} from "./sessions-wait.io"

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

const buildRegistryLayer = (sessions: Map<string, SessionState>): Layer.Layer<SessionRegistry> =>
  Layer.succeed(SessionRegistry, {
    snapshot: () => Promise.resolve(Array.from(sessions.values())),
    getOne: (short) => Promise.resolve(sessions.get(short)),
    // Not exercised by SessionWaitIo — present only to satisfy SessionRegistryApi.
    diagnostics: () => Promise.resolve(undefined),
  })

let runtime: ManagedRuntime.ManagedRuntime<SessionWaitIo, never> | null = null

const startRuntime = (sessions: Map<string, SessionState>) => {
  const layer = Layer.provide(SessionWaitIoLive, buildRegistryLayer(sessions))
  runtime = ManagedRuntime.make(layer)
  return runtime
}

afterEach(async () => {
  if (runtime) {
    await runtime.dispose()
    runtime = null
  }
})

const runWait = (input: {
  readonly short: string
  readonly request: WaitRequest
  readonly pinnedSessionId?: string | undefined
  readonly readTerminalState?: TerminalStateReader | undefined
}): Promise<WaitOutcome> => {
  if (!runtime) throw new Error("runtime not started")
  return runtime.runPromise(Effect.flatMap(SessionWaitIo, (api) => api.wait(input)))
}

// Stands in for the door terminal.routes.ts publishes and api.ts injects: one
// screen classification, keyed the way GET /terminal/states keys it.
const readerFor =
  (records: Record<string, { readonly state: string }>): TerminalStateReader =>
  ({ scope, id }) => {
    const record = records[`${scope}:${id}`]
    if (!record) return undefined
    return {
      state: record.state,
      matcher: undefined,
      evidence: undefined,
      at: "2026-07-28T00:00:00.000Z",
    }
  }

const defaultRequest = (overrides: Partial<WaitRequest> = {}): WaitRequest => ({
  until: ["done"],
  timeoutMs: 2_000,
  via: "supervisor",
  ...overrides,
})

describe("SessionWaitIo — immediate resolution", () => {
  it("returns NotFound for an unknown short without subscribing to the bus", async () => {
    const before = sseBus.subscriberCount()
    startRuntime(new Map())
    const outcome = await runWait({ short: "missing", request: defaultRequest() })
    expect(outcome).toEqual({ _tag: "NotFound" })
    expect(sseBus.subscriberCount()).toBe(before)
  })

  it("returns Satisfied with waitedMs 0 when the session is already in an awaited state", async () => {
    const before = sseBus.subscriberCount()
    const sessions = new Map([["ab12", makeSession({ short: "ab12", state: "done" })]])
    startRuntime(sessions)
    const outcome = await runWait({ short: "ab12", request: defaultRequest() })
    expect(outcome).toEqual({ _tag: "Satisfied", state: "done", via: "supervisor", waitedMs: 0 })
    expect(sseBus.subscriberCount()).toBe(before)
  })
})

const publishState = (data: {
  readonly short: string
  readonly sessionId?: string
  readonly state: string
}): void => {
  sseBus.publish({ type: "session.state", data })
}

const publishRemoved = (short: string): void => {
  sseBus.publish({ type: "session.removed", data: { short } })
}

// The exact payload publishTerminalState puts on the bus.
const publishTerminal = (data: {
  readonly scope: string
  readonly id: string
  readonly state: string
}): void => {
  sseBus.publish({
    type: "terminal.state",
    data: { ...data, matcher: "prompt-resting", evidence: "❯", at: new Date().toISOString() },
  })
}

// Seeds a single "ab12" session, starts the runtime, kicks off a wait against
// it, and gives the subscription time to attach — every bus-driven test below
// needs exactly this before it can safely publish.
const beginWait = async (input: {
  readonly session?: Partial<SessionState>
  readonly request?: Partial<WaitRequest>
  readonly pinnedSessionId?: string
  readonly readTerminalState?: TerminalStateReader
}): Promise<{ readonly before: number; readonly promise: Promise<WaitOutcome> }> => {
  const before = sseBus.subscriberCount()
  const sessions = new Map([["ab12", makeSession({ short: "ab12", ...input.session })]])
  startRuntime(sessions)
  const promise = runWait({
    short: "ab12",
    request: defaultRequest(input.request),
    pinnedSessionId: input.pinnedSessionId,
    readTerminalState: input.readTerminalState,
  })
  await sleep(30) // let the wait subscribe before the caller publishes
  return { before, promise }
}

describe("SessionWaitIo — bus-driven resolution", () => {
  it("resolves Satisfied once a later session.state event reaches an awaited state", async () => {
    const { before, promise } = await beginWait({ session: { sessionId: "sess-1" } })
    publishState({ short: "ab12", sessionId: "sess-1", state: "done" })
    const outcome = await promise
    expect(outcome._tag).toBe("Satisfied")
    if (outcome._tag === "Satisfied") {
      expect(outcome.state).toBe("done")
      expect(outcome.via).toBe("supervisor")
      expect(outcome.waitedMs).toBeGreaterThanOrEqual(0)
    }
    expect(sseBus.subscriberCount()).toBe(before)
  })

  it("resolves Timeout when no matching event arrives before timeoutMs", async () => {
    const before = sseBus.subscriberCount()
    startRuntime(new Map([["ab12", makeSession({ short: "ab12" })]]))
    const outcome = await runWait({
      short: "ab12",
      request: defaultRequest({ until: ["done"], timeoutMs: 50 }),
    })
    expect(outcome._tag).toBe("Timeout")
    if (outcome._tag === "Timeout") expect(outcome.waitedMs).toBeGreaterThanOrEqual(50)
    expect(sseBus.subscriberCount()).toBe(before)
  })

  it("resolves Removed when the session is removed while waiting", async () => {
    const { before, promise } = await beginWait({})
    publishRemoved("ab12")
    expect(await promise).toEqual({ _tag: "Removed" })
    expect(sseBus.subscriberCount()).toBe(before)
  })

  it("resolves OccupantChanged when a replacement session takes the same short", async () => {
    const { before, promise } = await beginWait({ session: { sessionId: "sess-1" } })
    // A different occupant reaching "done" must not satisfy a wait pinned to
    // sess-1 — the wait reports the occupant swap instead.
    publishState({ short: "ab12", sessionId: "sess-2", state: "done" })
    expect(await promise).toEqual({ _tag: "OccupantChanged" })
    expect(sseBus.subscriberCount()).toBe(before)
  })

  it("uses the caller-supplied pinnedSessionId over the session's own sessionId", async () => {
    // The registry read observes no sessionId yet (spawn in flight); the
    // caller pins to the id it already knows from its own send/dispatch call.
    const { before, promise } = await beginWait({ pinnedSessionId: "sess-pinned" })
    publishState({ short: "ab12", sessionId: "sess-other", state: "done" })
    expect(await promise).toEqual({ _tag: "OccupantChanged" })
    expect(sseBus.subscriberCount()).toBe(before)
  })

  it("ignores events for other sessions and unrelated states before resolving", async () => {
    const { before, promise } = await beginWait({ session: { sessionId: "sess-1" } })
    publishState({ short: "cd34", sessionId: "sess-9", state: "done" })
    publishState({ short: "ab12", sessionId: "sess-1", state: "working" })
    publishState({ short: "ab12", sessionId: "sess-1", state: "done" })
    const outcome = await promise
    expect(outcome).toEqual({
      _tag: "Satisfied",
      state: "done",
      via: "supervisor",
      waitedMs: expect.any(Number),
    })
    expect(sseBus.subscriberCount()).toBe(before)
  })
})

// The reason this slice grew a second event source at all: session 4d76edc1
// sat at `working` in state.json for 24 hours while its screen showed an empty
// prompt. No supervisor-sourced wait could ever have noticed.
describe("SessionWaitIo — screen-derived resolution", () => {
  it("resolves Satisfied from a terminal.state event when via is screen", async () => {
    const { before, promise } = await beginWait({
      session: { state: "working", sessionId: "sess-1" },
      request: { until: ["idle"], via: "screen" },
    })
    publishTerminal({ scope: "session", id: "ab12", state: "idle" })
    const outcome = await promise
    expect(outcome).toEqual({
      _tag: "Satisfied",
      state: "idle",
      via: "screen",
      waitedMs: expect.any(Number),
    })
    expect(sseBus.subscriberCount()).toBe(before)
  })

  it("resolves Satisfied from a terminal.state event when via is either", async () => {
    const { promise } = await beginWait({
      session: { state: "working", sessionId: "sess-1" },
      request: { until: ["blocked"], via: "either" },
    })
    publishTerminal({ scope: "session", id: "ab12", state: "blocked" })
    expect(await promise).toMatchObject({ _tag: "Satisfied", state: "blocked", via: "screen" })
  })

  it("ignores terminal.state entirely under the default via, timing out instead", async () => {
    const { before, promise } = await beginWait({
      session: { state: "working", sessionId: "sess-1" },
      request: { until: ["idle"], timeoutMs: 120 },
    })
    publishTerminal({ scope: "session", id: "ab12", state: "idle" })
    expect(await promise).toMatchObject({ _tag: "Timeout" })
    expect(sseBus.subscriberCount()).toBe(before)
  })

  it("ignores a supervisor session.state event when via is screen", async () => {
    const { promise } = await beginWait({
      session: { state: "working", sessionId: "sess-1" },
      request: { until: ["done"], timeoutMs: 120, via: "screen" },
    })
    publishState({ short: "ab12", sessionId: "sess-1", state: "done" })
    expect(await promise).toMatchObject({ _tag: "Timeout" })
  })

  it("ignores a terminal.state event for a non-session scope", async () => {
    const { promise } = await beginWait({
      session: { state: "working", sessionId: "sess-1" },
      request: { until: ["idle"], timeoutMs: 120, via: "screen" },
    })
    publishTerminal({ scope: "project", id: "ab12", state: "idle" })
    expect(await promise).toMatchObject({ _tag: "Timeout" })
  })

  it("ignores an unknown screen classification — it is not evidence of a state", async () => {
    const { promise } = await beginWait({
      session: { state: "working", sessionId: "sess-1" },
      request: { until: ["idle", "working", "blocked"], timeoutMs: 120, via: "screen" },
    })
    publishTerminal({ scope: "session", id: "ab12", state: "unknown" })
    expect(await promise).toMatchObject({ _tag: "Timeout" })
  })

  it("satisfies immediately from the CURRENT screen, without waiting for a transition", async () => {
    const before = sseBus.subscriberCount()
    startRuntime(new Map([["ab12", makeSession({ short: "ab12", state: "working" })]]))
    const outcome = await runWait({
      short: "ab12",
      request: defaultRequest({ until: ["blocked"], via: "screen" }),
      readTerminalState: readerFor({ "session:ab12": { state: "blocked" } }),
    })
    expect(outcome).toEqual({ _tag: "Satisfied", state: "blocked", via: "screen", waitedMs: 0 })
    // Settled before subscribing at all — no transition was ever needed.
    expect(sseBus.subscriberCount()).toBe(before)
  })

  it("does not consult the current screen when via is supervisor", async () => {
    startRuntime(new Map([["ab12", makeSession({ short: "ab12", state: "working" })]]))
    const outcome = await runWait({
      short: "ab12",
      request: defaultRequest({ until: ["blocked"], timeoutMs: 120 }),
      readTerminalState: readerFor({ "session:ab12": { state: "blocked" } }),
    })
    expect(outcome).toMatchObject({ _tag: "Timeout" })
  })

  it("keeps listening when the reader has no record for this short", async () => {
    const { promise } = await beginWait({
      session: { state: "working" },
      request: { until: ["idle"], via: "screen" },
      readTerminalState: readerFor({ "session:cd34": { state: "idle" } }),
    })
    publishTerminal({ scope: "session", id: "ab12", state: "idle" })
    expect(await promise).toMatchObject({ _tag: "Satisfied", state: "idle", via: "screen" })
  })
})
