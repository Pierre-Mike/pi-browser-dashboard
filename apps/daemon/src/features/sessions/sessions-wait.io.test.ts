import { afterEach, describe, expect, it } from "bun:test"
import { Effect, Layer, ManagedRuntime } from "effect"
import { sseBus } from "../../platform/sse-bus"
import type { SessionState } from "./sessions.core"
import { SessionRegistry } from "./sessions.io"
import { makeSessionState as makeSession } from "./sessions.testFixtures"
import type { WaitRequest } from "./sessions-wait.core"
import {
  makeSessionWaitIoLive,
  SessionWaitIo,
  systemWaitClock,
  type TerminalScreensPort,
  type TerminalStateReader,
  type WaitClock,
  type WaitOutcome,
} from "./sessions-wait.io"

const buildRegistryLayer = (sessions: Map<string, SessionState>): Layer.Layer<SessionRegistry> =>
  Layer.succeed(SessionRegistry, {
    snapshot: () => Promise.resolve(Array.from(sessions.values())),
    getOne: (short) => Promise.resolve(sessions.get(short)),
    // Not exercised by SessionWaitIo — present only to satisfy SessionRegistryApi.
    diagnostics: () => Promise.resolve(undefined),
  })

// The clock the whole suite runs on. Time advances only when a test advances
// it, and the timeout fires only when a test fires it, so every `waitedMs` here
// is an exact number rather than a measurement — and a wait with
// `timeoutMs: 120` costs no milliseconds at all.
//
// This is the fix for the flake this file used to carry: the timeout test
// asserted `waitedMs >= 50` against a real 50ms timer, and CI produced 49
// because the timer and the reading came off two different clocks.
const makeFakeClock = () => {
  let nowMs = 0
  let pending: { readonly delayMs: number; readonly run: () => void } | undefined
  const clock: WaitClock = {
    now: () => nowMs,
    after: (input) => {
      pending = input
      return () => {
        pending = undefined
      }
    },
  }
  return {
    clock,
    // True once the wait has reached `Effect.async` and armed its timeout —
    // the same synchronous block that subscribes to the bus, so this is also
    // the signal that publishing is now safe.
    armed: (): boolean => pending !== undefined,
    advance: (ms: number): void => {
      nowMs += ms
    },
    // Fire the timeout the way the runtime would: the clock has reached the
    // deadline, so move it there first, then run the callback.
    fireTimeout: (): void => {
      const timer = pending
      if (!timer) throw new Error("no timeout armed")
      pending = undefined
      nowMs += timer.delayMs
      timer.run()
    },
    // Fire it having advanced by LESS than the delay — what a runtime whose
    // timer clock and reading clock disagree actually does, and exactly the
    // condition that failed on CI.
    fireTimeoutEarlyBy: (ms: number): void => {
      const timer = pending
      if (!timer) throw new Error("no timeout armed")
      pending = undefined
      nowMs += timer.delayMs - ms
      timer.run()
    },
  }
}

let fake = makeFakeClock()
let runtime: ManagedRuntime.ManagedRuntime<SessionWaitIo, never> | null = null

const startRuntime = (sessions: Map<string, SessionState>) => {
  fake = makeFakeClock()
  const layer = Layer.provide(
    makeSessionWaitIoLive({ clock: fake.clock }),
    buildRegistryLayer(sessions),
  )
  runtime = ManagedRuntime.make(layer)
  return runtime
}

afterEach(async () => {
  if (runtime) {
    await runtime.dispose()
    runtime = null
  }
})

// Yields to the runtime until `ready` holds, instead of sleeping a guessed
// number of milliseconds and hoping. Bounded so a genuine hang fails as a test
// rather than as a suite that never returns; the bound is a backstop, never
// the normal path.
const until = async (ready: () => boolean): Promise<void> => {
  for (let i = 0; i < 5_000; i++) {
    if (ready()) return
    await new Promise((r) => setTimeout(r, 0))
  }
  throw new Error("condition never became true")
}

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
    data: { ...data, matcher: "prompt-resting", evidence: "❯", at: new Date().toISOString() },
  })
}

// Seeds a single "ab12" session, starts the runtime, kicks off a wait against
// it, and waits for the subscription to actually attach — every bus-driven test
// below needs exactly this before it can safely publish.
//
// The readiness signal is the wait's own armed timeout, not a fixed sleep: the
// bus subscription and the timeout are registered in the same synchronous
// block, so `armed()` is the precise moment publishing becomes safe. A sleep
// long enough to be safe on a loaded CI runner is a sleep wasted on every other
// run, and one that is not long enough is a flake.
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
  await until(fake.armed)
  return { before, promise }
}

describe("SessionWaitIo — bus-driven resolution", () => {
  it("resolves Satisfied once a later session.state event reaches an awaited state", async () => {
    const { before, promise } = await beginWait({ session: { sessionId: "sess-1" } })
    fake.advance(37)
    publishState({ short: "ab12", sessionId: "sess-1", state: "done" })
    // waitedMs is the clock's own reading, so it is an exact 37 rather than
    // "some non-negative number of real milliseconds".
    expect(await promise).toEqual({
      _tag: "Satisfied",
      state: "done",
      via: "supervisor",
      waitedMs: 37,
    })
    expect(sseBus.subscriberCount()).toBe(before)
  })

  it("resolves Timeout when no matching event arrives before timeoutMs", async () => {
    const { before, promise } = await beginWait({ request: { until: ["done"], timeoutMs: 50 } })
    fake.fireTimeout()
    expect(await promise).toEqual({ _tag: "Timeout", waitedMs: 50 })
    expect(sseBus.subscriberCount()).toBe(before)
  })

  // The CI flake, as a test. A runtime schedules its timers on one clock and
  // the wait used to read elapsed time off another; when the two disagree by a
  // fraction of a millisecond the reading lands below the timeout that was
  // actually honoured. That is how this file once reported `waitedMs: 49` for
  // a `timeoutMs: 50` wait — green on the re-run, and green in the sibling job
  // on the same commit.
  it("never reports having waited less than timeoutMs, even on an early-firing timer", async () => {
    const { promise } = await beginWait({ request: { until: ["done"], timeoutMs: 50 } })
    fake.fireTimeoutEarlyBy(1)
    expect(await promise).toEqual({ _tag: "Timeout", waitedMs: 50 })
  })

  it("reports a genuinely late timer in full — the floor is not a clamp", async () => {
    const { promise } = await beginWait({ request: { until: ["done"], timeoutMs: 50 } })
    // A busy event loop delivered the timeout 800ms late; that IS the caller's
    // signal, so it must survive intact.
    fake.advance(800)
    fake.fireTimeout()
    expect(await promise).toEqual({ _tag: "Timeout", waitedMs: 850 })
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
    expect(await promise).toEqual({
      _tag: "Satisfied",
      state: "done",
      via: "supervisor",
      waitedMs: 0,
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
    fake.advance(12)
    publishTerminal({ scope: "session", id: "ab12", state: "idle" })
    expect(await promise).toEqual({
      _tag: "Satisfied",
      state: "idle",
      via: "screen",
      waitedMs: 12,
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

  // The four "ignores X" tests below publish the event that must NOT settle the
  // wait and then fire the timeout by hand. sseBus.publish is synchronous, so
  // by the time the timeout fires the event has provably been evaluated and
  // dropped — stronger evidence than "nothing happened for 120ms", and free.
  it("ignores terminal.state entirely under the default via, timing out instead", async () => {
    const { before, promise } = await beginWait({
      session: { state: "working", sessionId: "sess-1" },
      request: { until: ["idle"], timeoutMs: 120 },
    })
    publishTerminal({ scope: "session", id: "ab12", state: "idle" })
    fake.fireTimeout()
    expect(await promise).toEqual({ _tag: "Timeout", waitedMs: 120 })
    expect(sseBus.subscriberCount()).toBe(before)
  })

  it("ignores a supervisor session.state event when via is screen", async () => {
    const { promise } = await beginWait({
      session: { state: "working", sessionId: "sess-1" },
      request: { until: ["done"], timeoutMs: 120, via: "screen" },
    })
    publishState({ short: "ab12", sessionId: "sess-1", state: "done" })
    fake.fireTimeout()
    expect(await promise).toMatchObject({ _tag: "Timeout" })
  })

  it("ignores a terminal.state event for a non-session scope", async () => {
    const { promise } = await beginWait({
      session: { state: "working", sessionId: "sess-1" },
      request: { until: ["idle"], timeoutMs: 120, via: "screen" },
    })
    publishTerminal({ scope: "project", id: "ab12", state: "idle" })
    fake.fireTimeout()
    expect(await promise).toMatchObject({ _tag: "Timeout" })
  })

  it("ignores an unknown screen classification — it is not evidence of a state", async () => {
    const { promise } = await beginWait({
      session: { state: "working", sessionId: "sess-1" },
      request: { until: ["idle", "working", "blocked"], timeoutMs: 120, via: "screen" },
    })
    publishTerminal({ scope: "session", id: "ab12", state: "unknown" })
    fake.fireTimeout()
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
    const { promise } = await beginWait({
      session: { state: "working" },
      request: { until: ["blocked"], timeoutMs: 120 },
      readTerminalState: readerFor({ "session:ab12": { state: "blocked" } }),
    })
    // It armed a timeout at all, rather than settling from the screen it was
    // handed — that is the claim; firing it just collects the outcome.
    fake.fireTimeout()
    expect(await promise).toMatchObject({ _tag: "Timeout" })
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

// A controllable stand-in for the terminal slice's screen channel: `emit` plays
// the part of a poller pass, and `observers` lets a test prove the subscription
// was released.
const makeScreens = ({ enabled = true }: { enabled?: boolean } = {}) => {
  const observers = new Set<(s: { scope: string; id: string; text: string }) => void>()
  const port: TerminalScreensPort = {
    enabled: () => enabled,
    subscribe: (observer) => {
      observers.add(observer)
      return () => observers.delete(observer)
    },
  }
  return {
    port,
    observerCount: () => observers.size,
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
    fake.advance(9)
    screens.emit({
      scope: "session",
      id: "ab12",
      text: " Bash(rm -rf build)\n Do you want to proceed?\n ❯ 1. Yes",
    })
    expect(await promise).toEqual({
      _tag: "OutputMatched",
      matched: "Do you want to proceed?",
      waitedMs: 9,
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
    fake.fireTimeout()
    expect(await promise).toEqual({ _tag: "Timeout", waitedMs: 80 })
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
    fake.fireTimeout()
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
    fake.fireTimeout()
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
    fake.fireTimeout()
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

// Every suite above runs on the fake clock, so this is the only thing standing
// between the real wiring and nobody checking it. Deliberately no assertion on
// how long anything took — that is the class of assertion this file was
// changed to remove.
describe("systemWaitClock", () => {
  it("reads a monotonic clock, not the wall clock", () => {
    let previous = systemWaitClock.now()
    for (let i = 0; i < 100; i++) {
      const current = systemWaitClock.now()
      // Non-decreasing is the property that matters: it is what makes a
      // negative waitedMs impossible when the host re-syncs its wall clock
      // part-way through a wait.
      expect(current).toBeGreaterThanOrEqual(previous)
      previous = current
    }
    // Process-relative, not epoch milliseconds. Date.now() is the clock this
    // slice used to read, and reading it against a monotonic timer is what
    // produced `waitedMs: 49` for a `timeoutMs: 50` wait on CI.
    expect(systemWaitClock.now()).toBeLessThan(Date.now())
  })

  it("schedules a real timer and hands back a canceller that works", async () => {
    const fired: string[] = []
    // The cancelled timer has the shorter delay, so had cancelling not worked
    // it would have landed strictly before the kept one.
    const cancel = systemWaitClock.after({ delayMs: 0, run: () => fired.push("cancelled") })
    cancel()
    systemWaitClock.after({ delayMs: 5, run: () => fired.push("kept") })
    await until(() => fired.length > 0)
    expect(fired).toEqual(["kept"])
  })
})
