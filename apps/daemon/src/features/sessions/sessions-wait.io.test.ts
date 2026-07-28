import { afterEach, describe, expect, it } from "bun:test"
import { Effect, Layer, ManagedRuntime } from "effect"
import { sseBus } from "../../platform/sse-bus"
import type { SessionState } from "./sessions.core"
import { SessionRegistry } from "./sessions.io"
import { makeSessionState as makeSession } from "./sessions.testFixtures"
import type { WaitRequest } from "./sessions-wait.core"
import { SessionWaitIo, SessionWaitIoLive, type WaitOutcome } from "./sessions-wait.io"

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
}): Promise<WaitOutcome> => {
  if (!runtime) throw new Error("runtime not started")
  return runtime.runPromise(Effect.flatMap(SessionWaitIo, (api) => api.wait(input)))
}

const defaultRequest = (overrides: Partial<WaitRequest> = {}): WaitRequest => ({
  until: ["done"],
  timeoutMs: 2_000,
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
    expect(outcome).toEqual({ _tag: "Satisfied", state: "done", waitedMs: 0 })
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

// Seeds a single "ab12" session, starts the runtime, kicks off a wait against
// it, and gives the subscription time to attach — every bus-driven test below
// needs exactly this before it can safely publish.
const beginWait = async (input: {
  readonly session?: Partial<SessionState>
  readonly request?: Partial<WaitRequest>
  readonly pinnedSessionId?: string
}): Promise<{ readonly before: number; readonly promise: Promise<WaitOutcome> }> => {
  const before = sseBus.subscriberCount()
  const sessions = new Map([["ab12", makeSession({ short: "ab12", ...input.session })]])
  startRuntime(sessions)
  const promise = runWait({
    short: "ab12",
    request: defaultRequest(input.request),
    pinnedSessionId: input.pinnedSessionId,
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
    expect(outcome).toEqual({ _tag: "Satisfied", state: "done", waitedMs: expect.any(Number) })
    expect(sseBus.subscriberCount()).toBe(before)
  })
})
