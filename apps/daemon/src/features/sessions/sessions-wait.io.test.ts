import { afterEach, describe, expect, it } from "bun:test"
import { SCREEN_READING_MAX_AGE_MS } from "@pid/shared"
import { Effect, Layer, ManagedRuntime } from "effect"
import { sseBus } from "../../platform/sse-bus"
import type { SessionState } from "./sessions.core"
import { SessionRegistry } from "./sessions.io"
import { makeSessionState as makeSession } from "./sessions.testFixtures"
import type { WaitRequest } from "./sessions-wait.core"
import {
  SessionWaitIo,
  SessionWaitIoLive,
  type TerminalScreensPort,
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
  readonly terminalScreens?: TerminalScreensPort | undefined
}): Promise<WaitOutcome> => {
  if (!runtime) throw new Error("runtime not started")
  return runtime.runPromise(Effect.flatMap(SessionWaitIo, (api) => api.wait(input)))
}

// Stands in for the door terminal.routes.ts publishes and api.ts injects: one
// screen classification, keyed the way GET /terminal/states keys it.
//
// `readAgeMs` is how long ago that pane was read, and it defaults to 0 — read
// just now — because that is the only case in which the initial check is allowed
// to settle a wait from a stored record. The staleness cases below set it
// explicitly. `stateChangedAt` is deliberately left far in the past: dwell must
// have no influence on whether a reading is trusted.
const readerFor =
  (
    records: Record<string, { readonly state: string; readonly readAgeMs?: number }>,
  ): TerminalStateReader =>
  ({ scope, id }) => {
    const record = records[`${scope}:${id}`]
    if (!record) return undefined
    return {
      state: record.state,
      matcher: undefined,
      evidence: undefined,
      screenReadAt: new Date(Date.now() - (record.readAgeMs ?? 0)).toISOString(),
      stateChangedAt: "2026-07-28T00:00:00.000Z",
    }
  }

const defaultRequest = (overrides: Partial<WaitRequest> = {}): WaitRequest => ({
  until: ["done"],
  untilOutput: undefined,
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
    data: {
      ...data,
      matcher: "prompt-resting",
      evidence: "❯",
      screenReadAt: new Date().toISOString(),
      stateChangedAt: new Date().toISOString(),
    },
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
  readonly terminalScreens?: TerminalScreensPort
}): Promise<{ readonly before: number; readonly promise: Promise<WaitOutcome> }> => {
  const before = sseBus.subscriberCount()
  const sessions = new Map([["ab12", makeSession({ short: "ab12", ...input.session })]])
  startRuntime(sessions)
  const promise = runWait({
    short: "ab12",
    request: defaultRequest(input.request),
    pinnedSessionId: input.pinnedSessionId,
    readTerminalState: input.readTerminalState,
    terminalScreens: input.terminalScreens,
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

// The hole this closes: the initial check consulted the stored reading without
// ever asking how old it was, so a daemon with its poller off (or its timers
// dead) would answer `reached "idle" via screen` from a record nobody had
// refreshed since boot. An agent that blocks on the screen and gets a two-hour-old
// answer is worse off than one that timed out, because it proceeds.
describe("SessionWaitIo — stale screen readings", () => {
  // One screen-only wait against a session whose pane reads `idle`, with the
  // reading's age as the only variable — every case below asks "how old may the
  // record be", so the setup is shared and each test states just the age.
  const screenWaitOnIdleReading = ({
    readAgeMs,
    reader,
  }: {
    readonly readAgeMs?: number
    readonly reader?: TerminalStateReader
  }): Promise<WaitOutcome> => {
    startRuntime(new Map([["ab12", makeSession({ short: "ab12", state: "working" })]]))
    return runWait({
      short: "ab12",
      request: defaultRequest({ until: ["idle"], via: "screen", timeoutMs: 120 }),
      readTerminalState: reader ?? readerFor({ "session:ab12": { state: "idle", readAgeMs } }),
    })
  }

  it("does not satisfy from a reading older than the ceiling", async () => {
    // Timeout, not ScreenPollingDisabled: with a poller armed a fresh reading may
    // be one pass away, so the honest answer is to wait rather than to refuse.
    expect(
      await screenWaitOnIdleReading({ readAgeMs: SCREEN_READING_MAX_AGE_MS + 1_000 }),
    ).toMatchObject({ _tag: "Timeout" })
  })

  it("the measured failure: a 105-minute-old reading no longer settles a wait", async () => {
    expect(await screenWaitOnIdleReading({ readAgeMs: 105 * 60_000 })).toMatchObject({
      _tag: "Timeout",
    })
  })

  it("still satisfies from a reading taken within the ceiling", async () => {
    // The other side of the boundary, so the ceiling cannot become "never trust
    // the stored record" by accident — that would silently undo the
    // immediate-satisfy behaviour a screen wait exists for.
    expect(await screenWaitOnIdleReading({ readAgeMs: 1_000 })).toEqual({
      _tag: "Satisfied",
      state: "idle",
      via: "screen",
      waitedMs: 0,
    })
  })

  // The other half of "keep listening": having discarded the stale record, the
  // wait must still settle on the next real reading — a stale record must not
  // poison the wait it declined to satisfy.
  it("still settles on a fresh classification that arrives during the wait", async () => {
    const { promise } = await beginWait({
      session: { state: "working" },
      request: { until: ["idle"], via: "screen" },
      readTerminalState: readerFor({
        "session:ab12": { state: "idle", readAgeMs: 105 * 60_000 },
      }),
    })
    publishTerminal({ scope: "session", id: "ab12", state: "idle" })
    expect(await promise).toMatchObject({ _tag: "Satisfied", state: "idle", via: "screen" })
  })

  it("a stale screen never blocks the supervisor half of an `either` wait", async () => {
    startRuntime(new Map([["ab12", makeSession({ short: "ab12", state: "done" })]]))
    const outcome = await runWait({
      short: "ab12",
      request: defaultRequest({ until: ["done"], via: "either" }),
      readTerminalState: readerFor({
        "session:ab12": { state: "idle", readAgeMs: 105 * 60_000 },
      }),
    })
    expect(outcome).toEqual({ _tag: "Satisfied", state: "done", via: "supervisor", waitedMs: 0 })
  })

  // An unparseable stamp is the one case where the daemon cannot say when it
  // looked, which is precisely when a reading must not be trusted.
  it("does not satisfy from a reading whose read stamp will not parse", async () => {
    const outcome = await screenWaitOnIdleReading({
      reader: () => ({
        state: "idle",
        matcher: undefined,
        evidence: undefined,
        screenReadAt: "not a date",
        stateChangedAt: "not a date",
      }),
    })
    expect(outcome).toMatchObject({ _tag: "Timeout" })
  })
})

// The gap the ceiling opens on its own, and the last look that closes it. A poller
// pass that re-reads a pane and finds the SAME classification freshens
// `screenReadAt` and publishes nothing (markTerminalScreenRead is silent by
// design), so a wait that declined a stale reading and then watched that very
// reading be confirmed has nothing to hear on the bus. Looking once more at the
// stored record before giving up turns that timeout into the right answer.
describe("SessionWaitIo — the last look before giving up", () => {
  // A reader that is stale on its first call and fresh afterwards: exactly what a
  // nudged poller pass does to the map mid-wait, silently.
  const freshensAfterFirstRead = (): TerminalStateReader => {
    let calls = 0
    return () => {
      calls += 1
      return {
        state: "idle",
        matcher: "prompt-resting",
        evidence: "❯",
        screenReadAt: new Date(Date.now() - (calls === 1 ? 105 * 60_000 : 0)).toISOString(),
        stateChangedAt: "2026-07-28T00:00:00.000Z",
      }
    }
  }

  it("satisfies from a reading the poller freshened while the wait was listening", async () => {
    startRuntime(new Map([["ab12", makeSession({ short: "ab12", state: "working" })]]))
    const outcome = await runWait({
      short: "ab12",
      request: defaultRequest({ until: ["idle"], via: "screen", timeoutMs: 120 }),
      readTerminalState: freshensAfterFirstRead(),
    })
    expect(outcome).toMatchObject({ _tag: "Satisfied", state: "idle", via: "screen" })
    // Not zero: this reading was confirmed at the END of the wait, and saying so
    // is the difference between "the screen already said idle" and "the screen
    // was read again during the wait and said idle".
    if (outcome._tag === "Satisfied") expect(outcome.waitedMs).toBeGreaterThanOrEqual(120)
  })

  it("still times out when nothing ever refreshed the reading", async () => {
    startRuntime(new Map([["ab12", makeSession({ short: "ab12", state: "working" })]]))
    const outcome = await runWait({
      short: "ab12",
      request: defaultRequest({ until: ["idle"], via: "screen", timeoutMs: 120 }),
      readTerminalState: readerFor({ "session:ab12": { state: "idle", readAgeMs: 105 * 60_000 } }),
    })
    expect(outcome).toMatchObject({ _tag: "Timeout" })
  })

  it("never satisfies a supervisor-only wait, however fresh the screen is", async () => {
    startRuntime(new Map([["ab12", makeSession({ short: "ab12", state: "working" })]]))
    const outcome = await runWait({
      short: "ab12",
      // `via` defaults to supervisor here: the screen reads `idle` and is current,
      // and it still must not settle a wait that asked not to be told by it.
      request: defaultRequest({ until: ["idle"], timeoutMs: 120 }),
      readTerminalState: readerFor({ "session:ab12": { state: "idle" } }),
    })
    expect(outcome).toMatchObject({ _tag: "Timeout" })
  })

  it("does not turn an occupant swap or a removal into a late screen satisfy", async () => {
    // Only a Timeout gets a second look — every other outcome is already an
    // answer, and re-deciding it would overwrite news with an older observation.
    const { promise } = await beginWait({
      session: { state: "working" },
      request: { until: ["idle"], via: "screen" },
      readTerminalState: readerFor({ "session:ab12": { state: "idle", readAgeMs: 105 * 60_000 } }),
    })
    publishRemoved("ab12")
    expect(await promise).toEqual({ _tag: "Removed" })
  })
})

// Before judging the stored reading's age, the wait asks the poller to take a
// pass if its last one is stale — the same refresh-on-read GET /terminal/states
// does, and for the same reason (this daemon has lost every timer on a long
// uptime while its sockets stayed alive). The cost has to stay bounded: the port
// is called at most once per wait, and never at all by a wait that is not allowed
// to use screen evidence.
describe("SessionWaitIo — refresh before judging freshness", () => {
  it("nudges the poller once for a via: screen wait", async () => {
    const screens = makeScreens()
    startRuntime(new Map([["ab12", makeSession({ short: "ab12", state: "working" })]]))
    await runWait({
      short: "ab12",
      request: defaultRequest({ until: ["idle"], via: "screen", timeoutMs: 80 }),
      readTerminalState: readerFor({}),
      terminalScreens: screens.port,
    })
    expect(screens.refreshCount()).toBe(1)
  })

  it("nudges the poller for an `either` wait and for an untilOutput wait", async () => {
    const either = makeScreens()
    startRuntime(new Map([["ab12", makeSession({ short: "ab12", state: "working" })]]))
    await runWait({
      short: "ab12",
      request: defaultRequest({ until: ["idle"], via: "either", timeoutMs: 80 }),
      terminalScreens: either.port,
    })
    expect(either.refreshCount()).toBe(1)
    await runtime?.dispose()
    const output = makeScreens()
    startRuntime(new Map([["ab12", makeSession({ short: "ab12", state: "working" })]]))
    await runWait({
      short: "ab12",
      request: defaultRequest({ until: [], untilOutput: OUTPUT_PATTERN, timeoutMs: 80 }),
      terminalScreens: output.port,
    })
    expect(output.refreshCount()).toBe(1)
  })

  it("never nudges the poller for a supervisor-only wait", async () => {
    const screens = makeScreens()
    startRuntime(new Map([["ab12", makeSession({ short: "ab12", state: "working" })]]))
    await runWait({
      short: "ab12",
      request: defaultRequest({ until: ["done"], timeoutMs: 80 }),
      terminalScreens: screens.port,
    })
    // A supervisor wait may not be settled by the screen, so spending the
    // poller's subprocess budget on its behalf buys nothing.
    expect(screens.refreshCount()).toBe(0)
  })

  it("does not nudge, or throw, when no screen channel is wired at all", async () => {
    startRuntime(new Map([["ab12", makeSession({ short: "ab12", state: "working" })]]))
    const outcome = await runWait({
      short: "ab12",
      request: defaultRequest({ until: ["idle"], via: "screen", timeoutMs: 80 }),
      readTerminalState: readerFor({ "session:ab12": { state: "idle" } }),
    })
    // Still satisfies off the fresh record — the nudge is an optimisation, not a
    // precondition.
    expect(outcome).toEqual({ _tag: "Satisfied", state: "idle", via: "screen", waitedMs: 0 })
  })
})

// A controllable stand-in for the terminal slice's screen channel: `emit` plays
// the part of a poller pass, and `observers` lets a test prove the subscription
// was released.
const makeScreens = ({ enabled = true }: { enabled?: boolean } = {}) => {
  const observers = new Set<(s: { scope: string; id: string; text: string }) => void>()
  let refreshes = 0
  const port: TerminalScreensPort = {
    enabled: () => enabled,
    subscribe: (observer) => {
      observers.add(observer)
      return () => observers.delete(observer)
    },
    refreshIfStale: () => {
      refreshes += 1
    },
  }
  return {
    port,
    observerCount: () => observers.size,
    refreshCount: () => refreshes,
    emit: (screen: { scope: string; id: string; text: string }) => {
      for (const observer of [...observers]) observer(screen)
    },
  }
}

const OUTPUT_PATTERN = { text: "Do you want to proceed?", anchor: "anywhere" } as const

describe("SessionWaitIo — untilOutput", () => {
  it("resolves OutputMatched when a poller pass shows the pattern", async () => {
    const screens = makeScreens()
    const { promise } = await beginWait({
      session: { state: "working" },
      request: { until: [], untilOutput: OUTPUT_PATTERN },
      terminalScreens: screens.port,
    })
    screens.emit({
      scope: "session",
      id: "ab12",
      text: " Bash(rm -rf build)\n Do you want to proceed?\n ❯ 1. Yes",
    })
    const outcome = await promise
    expect(outcome).toEqual({
      _tag: "OutputMatched",
      matched: "Do you want to proceed?",
      waitedMs: expect.any(Number),
    })
  })

  it("releases the screen subscription once it settles", async () => {
    const screens = makeScreens()
    const { promise } = await beginWait({
      session: { state: "working" },
      request: { until: [], untilOutput: OUTPUT_PATTERN },
      terminalScreens: screens.port,
    })
    expect(screens.observerCount()).toBe(1)
    screens.emit({ scope: "session", id: "ab12", text: "Do you want to proceed?" })
    await promise
    expect(screens.observerCount()).toBe(0)
  })

  it("releases the screen subscription on timeout too", async () => {
    const screens = makeScreens()
    const { promise } = await beginWait({
      session: { state: "working" },
      request: { until: [], untilOutput: OUTPUT_PATTERN, timeoutMs: 80 },
      terminalScreens: screens.port,
    })
    expect(await promise).toMatchObject({ _tag: "Timeout" })
    expect(screens.observerCount()).toBe(0)
  })

  it("ignores a pass whose screen does not contain the pattern", async () => {
    const screens = makeScreens()
    const { promise } = await beginWait({
      session: { state: "working" },
      request: { until: [], untilOutput: OUTPUT_PATTERN, timeoutMs: 80 },
      terminalScreens: screens.port,
    })
    screens.emit({ scope: "session", id: "ab12", text: "Elucidating…" })
    expect(await promise).toMatchObject({ _tag: "Timeout" })
  })

  it("ignores a pass for another short, and for a non-session scope", async () => {
    const screens = makeScreens()
    const { promise } = await beginWait({
      session: { state: "working" },
      request: { until: [], untilOutput: OUTPUT_PATTERN, timeoutMs: 80 },
      terminalScreens: screens.port,
    })
    screens.emit({ scope: "session", id: "cd34", text: "Do you want to proceed?" })
    screens.emit({ scope: "project", id: "ab12", text: "Do you want to proceed?" })
    expect(await promise).toMatchObject({ _tag: "Timeout" })
  })

  it("does not subscribe to screens at all when no pattern was requested", async () => {
    const screens = makeScreens()
    const { promise } = await beginWait({
      session: { state: "working" },
      request: { until: ["done"], timeoutMs: 80 },
      terminalScreens: screens.port,
    })
    expect(screens.observerCount()).toBe(0)
    await promise
  })

  // Both conditions, one wait: whichever fires first settles it, and the
  // outcome says which one that was.
  it("lets the state condition win when it arrives first", async () => {
    const screens = makeScreens()
    const { promise } = await beginWait({
      session: { state: "working", sessionId: "sess-1" },
      request: { until: ["failed"], untilOutput: OUTPUT_PATTERN },
      terminalScreens: screens.port,
    })
    publishState({ short: "ab12", sessionId: "sess-1", state: "failed" })
    expect(await promise).toMatchObject({ _tag: "Satisfied", state: "failed", via: "supervisor" })
  })

  it("lets the pattern win when it arrives first", async () => {
    const screens = makeScreens()
    const { promise } = await beginWait({
      session: { state: "working", sessionId: "sess-1" },
      request: { until: ["failed"], untilOutput: OUTPUT_PATTERN },
      terminalScreens: screens.port,
    })
    screens.emit({ scope: "session", id: "ab12", text: "Do you want to proceed?" })
    expect(await promise).toMatchObject({ _tag: "OutputMatched" })
  })

  // `untilOutput` resolves off poller passes and nothing else, so a daemon with
  // polling off must say so rather than going quiet for the whole timeout.
  it("refuses the request when screen polling is disabled", async () => {
    startRuntime(new Map([["ab12", makeSession({ short: "ab12", state: "working" })]]))
    const outcome = await runWait({
      short: "ab12",
      request: defaultRequest({ until: [], untilOutput: OUTPUT_PATTERN }),
      terminalScreens: makeScreens({ enabled: false }).port,
    })
    expect(outcome).toEqual({ _tag: "ScreenPollingDisabled" })
  })

  it("refuses the request when no screen channel is wired at all", async () => {
    startRuntime(new Map([["ab12", makeSession({ short: "ab12", state: "working" })]]))
    const outcome = await runWait({
      short: "ab12",
      request: defaultRequest({ until: [], untilOutput: OUTPUT_PATTERN }),
    })
    expect(outcome).toEqual({ _tag: "ScreenPollingDisabled" })
  })

  it("refuses before touching the registry — an unknown short is still ScreenPollingDisabled", async () => {
    startRuntime(new Map())
    const outcome = await runWait({
      short: "missing",
      request: defaultRequest({ until: [], untilOutput: OUTPUT_PATTERN }),
      terminalScreens: makeScreens({ enabled: false }).port,
    })
    // Deliberate: the configuration fault is the more actionable of the two,
    // and reporting NotFound would send a caller chasing the wrong problem.
    expect(outcome).toEqual({ _tag: "ScreenPollingDisabled" })
  })

  it("does not refuse a state-only wait when polling is disabled", async () => {
    startRuntime(new Map([["ab12", makeSession({ short: "ab12", state: "done" })]]))
    const outcome = await runWait({
      short: "ab12",
      request: defaultRequest({ until: ["done"] }),
      terminalScreens: makeScreens({ enabled: false }).port,
    })
    expect(outcome).toMatchObject({ _tag: "Satisfied", state: "done" })
  })
})
