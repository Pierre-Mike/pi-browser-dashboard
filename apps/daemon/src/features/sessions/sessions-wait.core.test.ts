import { describe, expect, test } from "bun:test"
import { Either } from "effect"
import {
  decideInitial,
  decodeSessionRemovedEvent,
  decodeSessionStateEvent,
  decodeTerminalStateEvent,
  evaluateScreenObservation,
  evaluateWaitEvent,
  matchOutputPattern,
  OUTPUT_PATTERN_MAX_CHARS,
  parseWaitRequest,
  sessionSlugFromTerminalState,
  WAIT_TIMEOUT_DEFAULT_MS,
  WAIT_TIMEOUT_MAX_MS,
  type WaitRequest,
} from "./sessions-wait.core"

// Shared assertion for the reject cases below: parsing must fail, tagged
// with the expected WaitRequestError._tag.
const expectRejected = ({
  raw,
  tag,
}: {
  raw: unknown
  tag: "BadUntil" | "BadTimeout" | "BadVia" | "BadPattern"
}): void => {
  const out = parseWaitRequest(raw)
  expect(Either.isLeft(out)).toBe(true)
  if (Either.isLeft(out)) expect(out.left._tag).toBe(tag)
}

describe("parseWaitRequest", () => {
  test("accepts a single known state and applies the default timeout", () => {
    const out = parseWaitRequest({ until: ["done"] })
    expect(Either.isRight(out)).toBe(true)
    if (Either.isRight(out)) {
      expect(out.right).toEqual({
        until: ["done"],
        untilOutput: undefined,
        timeoutMs: WAIT_TIMEOUT_DEFAULT_MS,
        via: "supervisor",
      })
    }
  })

  test("de-duplicates repeated states in until", () => {
    const out = parseWaitRequest({ until: ["done", "done", "failed"] })
    expect(Either.isRight(out)).toBe(true)
    if (Either.isRight(out)) {
      expect(out.right.until).toEqual(["done", "failed"])
    }
  })

  test("rejects a non-object body", () => {
    expectRejected({ raw: "nope", tag: "BadUntil" })
  })

  test("rejects an empty until array", () => {
    expectRejected({ raw: { until: [] }, tag: "BadUntil" })
  })

  test("rejects a non-array until", () => {
    expectRejected({ raw: { until: "done" }, tag: "BadUntil" })
  })

  test("rejects an until entry that is not a known state slug", () => {
    expectRejected({ raw: { until: ["done", "vibing"] }, tag: "BadUntil" })
  })

  test("accepts an explicit in-range integer timeoutMs", () => {
    const out = parseWaitRequest({ until: ["done"], timeoutMs: 5_000 })
    expect(Either.isRight(out)).toBe(true)
    if (Either.isRight(out)) expect(out.right.timeoutMs).toBe(5_000)
  })

  test("rejects a zero timeoutMs", () => {
    expectRejected({ raw: { until: ["done"], timeoutMs: 0 }, tag: "BadTimeout" })
  })

  test("rejects a negative timeoutMs", () => {
    expectRejected({ raw: { until: ["done"], timeoutMs: -1 }, tag: "BadTimeout" })
  })

  test("rejects a timeoutMs over the max", () => {
    expectRejected({
      raw: { until: ["done"], timeoutMs: WAIT_TIMEOUT_MAX_MS + 1 },
      tag: "BadTimeout",
    })
  })

  test("accepts timeoutMs at exactly the max", () => {
    const out = parseWaitRequest({ until: ["done"], timeoutMs: WAIT_TIMEOUT_MAX_MS })
    expect(Either.isRight(out)).toBe(true)
    if (Either.isRight(out)) expect(out.right.timeoutMs).toBe(WAIT_TIMEOUT_MAX_MS)
  })

  test("rejects a non-integer timeoutMs", () => {
    expectRejected({ raw: { until: ["done"], timeoutMs: 1.5 }, tag: "BadTimeout" })
  })

  test("rejects a non-numeric timeoutMs", () => {
    expectRejected({ raw: { until: ["done"], timeoutMs: "soon" }, tag: "BadTimeout" })
  })

  // `via` defaults to "supervisor" so every caller written before the screen
  // became a wait source keeps exactly the semantics it was written against.
  test("defaults via to supervisor when the field is absent", () => {
    const out = parseWaitRequest({ until: ["done"] })
    expect(Either.isRight(out)).toBe(true)
    if (Either.isRight(out)) expect(out.right.via).toBe("supervisor")
  })

  test.each(["supervisor", "screen", "either"] as const)("accepts via %s", (via) => {
    const out = parseWaitRequest({ until: ["done"], via })
    expect(Either.isRight(out)).toBe(true)
    if (Either.isRight(out)) expect(out.right.via).toBe(via)
  })

  test("rejects an unknown via with BadVia", () => {
    expectRejected({ raw: { until: ["done"], via: "telepathy" }, tag: "BadVia" })
  })

  test("rejects a non-string via with BadVia", () => {
    expectRejected({ raw: { until: ["done"], via: 7 }, tag: "BadVia" })
  })
})

describe("parseWaitRequest — untilOutput", () => {
  test("accepts a bare string as an unanchored substring", () => {
    const out = parseWaitRequest({ untilOutput: "Do you want to proceed?" })
    expect(Either.isRight(out)).toBe(true)
    if (Either.isRight(out)) {
      expect(out.right.untilOutput).toEqual({ text: "Do you want to proceed?", anchor: "anywhere" })
      // No `until` needed when the pattern carries the condition.
      expect(out.right.until).toEqual([])
    }
  })

  test.each([
    "anywhere",
    "line-start",
    "line-end",
    "line",
  ] as const)("accepts the %s anchor", (anchor) => {
    const out = parseWaitRequest({ untilOutput: { text: "ready", anchor } })
    expect(Either.isRight(out)).toBe(true)
    if (Either.isRight(out)) expect(out.right.untilOutput?.anchor).toBe(anchor)
  })

  test("defaults the anchor to anywhere for the object form", () => {
    const out = parseWaitRequest({ untilOutput: { text: "ready" } })
    expect(Either.isRight(out)).toBe(true)
    if (Either.isRight(out)) expect(out.right.untilOutput?.anchor).toBe("anywhere")
  })

  test("accepts until and untilOutput together — they are independent conditions", () => {
    const out = parseWaitRequest({ until: ["failed"], untilOutput: "proceed?" })
    expect(Either.isRight(out)).toBe(true)
    if (Either.isRight(out)) {
      expect(out.right.until).toEqual(["failed"])
      expect(out.right.untilOutput?.text).toBe("proceed?")
    }
  })

  // A wait with neither condition would block until it timed out, which is a
  // caller bug worth a 400 rather than a 30-second silence.
  test("rejects a request with neither until nor untilOutput", () => {
    expectRejected({ raw: {}, tag: "BadUntil" })
  })

  test("still rejects an empty until when untilOutput is also present", () => {
    expectRejected({ raw: { until: [], untilOutput: "x" }, tag: "BadUntil" })
  })

  test("rejects an empty pattern", () => {
    expectRejected({ raw: { untilOutput: "" }, tag: "BadPattern" })
    expectRejected({ raw: { untilOutput: { text: "" } }, tag: "BadPattern" })
  })

  test("rejects a pattern over the length cap, and accepts one exactly at it", () => {
    expectRejected({
      raw: { untilOutput: "x".repeat(OUTPUT_PATTERN_MAX_CHARS + 1) },
      tag: "BadPattern",
    })
    const out = parseWaitRequest({ untilOutput: "x".repeat(OUTPUT_PATTERN_MAX_CHARS) })
    expect(Either.isRight(out)).toBe(true)
  })

  test("rejects an unknown anchor", () => {
    expectRejected({ raw: { untilOutput: { text: "x", anchor: "regex" } }, tag: "BadPattern" })
  })

  test("rejects a pattern that is neither a string nor an object with text", () => {
    expectRejected({ raw: { untilOutput: 42 }, tag: "BadPattern" })
    expectRejected({ raw: { untilOutput: ["x"] }, tag: "BadPattern" })
    expectRejected({ raw: { untilOutput: {} }, tag: "BadPattern" })
  })

  // The pattern is a literal, so every regex metacharacter is just a character.
  // This is the point of the design, not an accident of it.
  test("treats regex metacharacters as literal text", () => {
    const out = parseWaitRequest({ untilOutput: "(a+)+$" })
    expect(Either.isRight(out)).toBe(true)
    if (Either.isRight(out)) expect(out.right.untilOutput?.text).toBe("(a+)+$")
  })
})

describe("matchOutputPattern", () => {
  const screen = ["│ Bash(echo hi)", "  Do you want to proceed?", "❯ ", ""].join("\n")

  test("finds an unanchored substring and returns the trimmed line it was on", () => {
    expect(
      matchOutputPattern({
        pattern: { text: "want to proceed", anchor: "anywhere" },
        text: screen,
      }),
    ).toBe("Do you want to proceed?")
  })

  test("returns undefined when the pattern is absent", () => {
    expect(
      matchOutputPattern({ pattern: { text: "not on screen", anchor: "anywhere" }, text: screen }),
    ).toBeUndefined()
  })

  test("is case-sensitive", () => {
    expect(
      matchOutputPattern({ pattern: { text: "do you want", anchor: "anywhere" }, text: screen }),
    ).toBeUndefined()
  })

  test("line anchor requires the whole trimmed line to equal the pattern", () => {
    expect(
      matchOutputPattern({
        pattern: { text: "Do you want to proceed?", anchor: "line" },
        text: screen,
      }),
    ).toBe("Do you want to proceed?")
    expect(
      matchOutputPattern({ pattern: { text: "Do you want", anchor: "line" }, text: screen }),
    ).toBeUndefined()
  })

  test("line-start and line-end anchor to the trimmed line's ends", () => {
    expect(
      matchOutputPattern({ pattern: { text: "Do you", anchor: "line-start" }, text: screen }),
    ).toBe("Do you want to proceed?")
    expect(
      matchOutputPattern({ pattern: { text: "proceed?", anchor: "line-end" }, text: screen }),
    ).toBe("Do you want to proceed?")
    expect(
      matchOutputPattern({ pattern: { text: "you want", anchor: "line-start" }, text: screen }),
    ).toBeUndefined()
  })

  // The empty prompt line is padded with U+00A0, not a space — the bug that
  // made the prompt-resting classifier fire on 1 of 27 live screens. An
  // anchored pattern has to survive the same padding.
  test("anchors survive the NBSP padding a real dump emits", () => {
    expect(matchOutputPattern({ pattern: { text: "❯", anchor: "line" }, text: screen })).toBe("❯")
  })

  test("returns the FIRST matching line when several match", () => {
    const text = ["ready: one", "ready: two"].join("\n")
    expect(matchOutputPattern({ pattern: { text: "ready", anchor: "anywhere" }, text })).toBe(
      "ready: one",
    )
  })
})

describe("evaluateScreenObservation", () => {
  const observation = { scope: "session", short: "ab12", text: "Do you want to proceed?" }
  const target = { short: "ab12", sessionId: "sess-1" }
  const outputRequest = (overrides: Partial<WaitRequest> = {}): WaitRequest =>
    request({ until: [], untilOutput: { text: "proceed?", anchor: "anywhere" }, ...overrides })

  test("matches and reports the line it saw", () => {
    expect(evaluateScreenObservation({ request: outputRequest(), target, observation })).toEqual({
      _tag: "OutputMatched",
      matched: "Do you want to proceed?",
    })
  })

  test("ignores an observation when the request asked for no pattern", () => {
    expect(evaluateScreenObservation({ request: request(), target, observation })).toEqual({
      _tag: "Ignore",
    })
  })

  test("ignores an observation for another short", () => {
    expect(
      evaluateScreenObservation({
        request: outputRequest(),
        target,
        observation: { ...observation, short: "cd34" },
      }),
    ).toEqual({ _tag: "Ignore" })
  })

  test.each(["global", "orchestrator", "project"])("ignores the %s scope", (scope) => {
    expect(
      evaluateScreenObservation({
        request: outputRequest(),
        target,
        observation: { ...observation, scope },
      }),
    ).toEqual({ _tag: "Ignore" })
  })

  test("ignores a screen that does not contain the pattern", () => {
    expect(
      evaluateScreenObservation({
        request: outputRequest(),
        target,
        observation: { ...observation, text: "Elucidating…" },
      }),
    ).toEqual({ _tag: "Ignore" })
  })

  // A screen belongs to the zellij session, not to an occupant, so there is no
  // sessionId to compare — an output match must work with or without a pin
  // rather than reading as an occupant swap.
  test.each(["sess-1", undefined])("matches regardless of the occupant pin (%s)", (sessionId) => {
    expect(
      evaluateScreenObservation({
        request: outputRequest(),
        target: { short: "ab12", sessionId },
        observation,
      })._tag,
    ).toBe("OutputMatched")
  })

  // `via` is about how STATE is read; a pattern is about bytes on a screen.
  // Gating one on the other would make this combination unsatisfiable.
  test.each([
    "supervisor",
    "screen",
    "either",
  ] as const)("matches under via %s — via does not gate a pattern", (via) => {
    expect(
      evaluateScreenObservation({ request: outputRequest({ via }), target, observation })._tag,
    ).toBe("OutputMatched")
  })
})

describe("sessionSlugFromTerminalState", () => {
  test("maps each classifiable screen state onto the same-named session slug", () => {
    expect(sessionSlugFromTerminalState("working")).toBe("working")
    expect(sessionSlugFromTerminalState("blocked")).toBe("blocked")
    expect(sessionSlugFromTerminalState("idle")).toBe("idle")
  })

  // An unclassified screen is the absence of evidence, not evidence of a
  // state — it must never be able to satisfy a wait.
  test("maps unknown, and anything unrecognized, to undefined", () => {
    expect(sessionSlugFromTerminalState("unknown")).toBeUndefined()
    expect(sessionSlugFromTerminalState("done")).toBeUndefined()
    expect(sessionSlugFromTerminalState("")).toBeUndefined()
  })
})

const request = (overrides: Partial<WaitRequest> = {}): WaitRequest => ({
  until: ["done", "failed"],
  untilOutput: undefined,
  timeoutMs: WAIT_TIMEOUT_DEFAULT_MS,
  via: "supervisor",
  ...overrides,
})

describe("evaluateWaitEvent", () => {
  test("ignores an event for a different session short", () => {
    const decision = evaluateWaitEvent({
      request: request(),
      target: { short: "ab12", sessionId: "sess-1" },
      event: { kind: "state", short: "cd34", sessionId: "sess-1", state: "done" },
    })
    expect(decision).toEqual({ _tag: "Ignore" })
  })

  test("reports Removed for a removed event on the target short", () => {
    const decision = evaluateWaitEvent({
      request: request(),
      target: { short: "ab12", sessionId: "sess-1" },
      event: { kind: "removed", short: "ab12" },
    })
    expect(decision).toEqual({ _tag: "Removed" })
  })

  test("reports Removed even when the target had no pinned sessionId", () => {
    const decision = evaluateWaitEvent({
      request: request(),
      target: { short: "ab12", sessionId: undefined },
      event: { kind: "removed", short: "ab12" },
    })
    expect(decision).toEqual({ _tag: "Removed" })
  })

  test("reports OccupantChanged when the event carries a different sessionId than the pin", () => {
    const decision = evaluateWaitEvent({
      request: request(),
      target: { short: "ab12", sessionId: "sess-1" },
      event: { kind: "state", short: "ab12", sessionId: "sess-2", state: "working" },
    })
    expect(decision).toEqual({ _tag: "OccupantChanged" })
  })

  test("does not report a change when the target had no sessionId at wait start", () => {
    const decision = evaluateWaitEvent({
      request: request(),
      target: { short: "ab12", sessionId: undefined },
      event: { kind: "state", short: "ab12", sessionId: "sess-2", state: "done" },
    })
    expect(decision).toEqual({ _tag: "Satisfied", state: "done", via: "supervisor" })
  })

  test("does not report a change when the event carries no sessionId", () => {
    const decision = evaluateWaitEvent({
      request: request(),
      target: { short: "ab12", sessionId: "sess-1" },
      event: { kind: "state", short: "ab12", sessionId: undefined, state: "done" },
    })
    expect(decision).toEqual({ _tag: "Satisfied", state: "done", via: "supervisor" })
  })

  test("reports Satisfied when the same occupant reaches an awaited state", () => {
    const decision = evaluateWaitEvent({
      request: request(),
      target: { short: "ab12", sessionId: "sess-1" },
      event: { kind: "state", short: "ab12", sessionId: "sess-1", state: "failed" },
    })
    expect(decision).toEqual({ _tag: "Satisfied", state: "failed", via: "supervisor" })
  })

  test("ignores a state not in the awaited list", () => {
    const decision = evaluateWaitEvent({
      request: request(),
      target: { short: "ab12", sessionId: "sess-1" },
      event: { kind: "state", short: "ab12", sessionId: "sess-1", state: "working" },
    })
    expect(decision).toEqual({ _tag: "Ignore" })
  })
})

describe("decideInitial", () => {
  test("reports NotFound when there is no current session", () => {
    expect(decideInitial({ request: request(), current: undefined, terminal: undefined })).toEqual({
      _tag: "NotFound",
    })
  })

  test("reports Satisfied when the current state is already in the awaited list", () => {
    expect(
      decideInitial({ request: request(), current: { state: "done" }, terminal: undefined }),
    ).toEqual({
      _tag: "Satisfied",
      state: "done",
      via: "supervisor",
    })
  })

  test("reports Pending when the current state is not yet awaited", () => {
    expect(
      decideInitial({ request: request(), current: { state: "working" }, terminal: undefined }),
    ).toEqual({
      _tag: "Pending",
    })
  })
})

// The whole point of `via`: which event source is allowed to settle the wait.
// A supervisor `state.json` write and a screen classification are two
// independent observations of the same session, and a caller that asked for
// one must never be settled by the other.
describe("evaluateWaitEvent — via gating", () => {
  const supervisorEvent = {
    kind: "state",
    short: "ab12",
    sessionId: "sess-1",
    state: "done",
  } as const
  const terminalEvent = { kind: "terminal", short: "ab12", state: "idle" } as const
  const target = { short: "ab12", sessionId: "sess-1" }

  test("via supervisor: a supervisor event satisfies", () => {
    const decision = evaluateWaitEvent({
      request: request({ via: "supervisor" }),
      target,
      event: supervisorEvent,
    })
    expect(decision).toEqual({ _tag: "Satisfied", state: "done", via: "supervisor" })
  })

  test("via supervisor: a terminal event is ignored", () => {
    const decision = evaluateWaitEvent({
      request: request({ until: ["idle"], via: "supervisor" }),
      target,
      event: terminalEvent,
    })
    expect(decision).toEqual({ _tag: "Ignore" })
  })

  test("via screen: a supervisor event is ignored even when it names an awaited state", () => {
    const decision = evaluateWaitEvent({
      request: request({ via: "screen" }),
      target,
      event: supervisorEvent,
    })
    expect(decision).toEqual({ _tag: "Ignore" })
  })

  test("via screen: a terminal event satisfies and reports the screen as the source", () => {
    const decision = evaluateWaitEvent({
      request: request({ until: ["idle"], via: "screen" }),
      target,
      event: terminalEvent,
    })
    expect(decision).toEqual({ _tag: "Satisfied", state: "idle", via: "screen" })
  })

  test("via either: both sources satisfy, each naming itself", () => {
    expect(
      evaluateWaitEvent({ request: request({ via: "either" }), target, event: supervisorEvent }),
    ).toEqual({ _tag: "Satisfied", state: "done", via: "supervisor" })
    expect(
      evaluateWaitEvent({
        request: request({ until: ["idle"], via: "either" }),
        target,
        event: terminalEvent,
      }),
    ).toEqual({ _tag: "Satisfied", state: "idle", via: "screen" })
  })

  test("a terminal event whose state is not awaited is ignored, not satisfied", () => {
    const decision = evaluateWaitEvent({
      request: request({ until: ["blocked"], via: "screen" }),
      target,
      event: terminalEvent,
    })
    expect(decision).toEqual({ _tag: "Ignore" })
  })

  test("a terminal event for another short is ignored", () => {
    const decision = evaluateWaitEvent({
      request: request({ until: ["idle"], via: "screen" }),
      target,
      event: { kind: "terminal", short: "cd34", state: "idle" },
    })
    expect(decision).toEqual({ _tag: "Ignore" })
  })

  // A terminal event carries no sessionId at all — the screen belongs to the
  // zellij session, not to an occupant — so the occupant pin cannot apply to
  // it and must not be evaluated as if it were missing from a supervisor
  // event.
  test("a terminal event never reads as OccupantChanged, pinned or not", () => {
    for (const sessionId of ["sess-1", undefined]) {
      const decision = evaluateWaitEvent({
        request: request({ until: ["idle"], via: "either" }),
        target: { short: "ab12", sessionId },
        event: terminalEvent,
      })
      expect(decision).toEqual({ _tag: "Satisfied", state: "idle", via: "screen" })
    }
  })

  // Removal is not an observation about state — it is the session ceasing to
  // exist, which ends the wait no matter which source the caller trusts.
  test.each([
    "supervisor",
    "screen",
    "either",
  ] as const)("session.removed settles Removed under via %s", (via) => {
    const decision = evaluateWaitEvent({
      request: request({ via }),
      target,
      event: { kind: "removed", short: "ab12" },
    })
    expect(decision).toEqual({ _tag: "Removed" })
  })
})

// The 4d76edc1 case at wait start rather than mid-wait: a screen that is
// ALREADY blocked when the wait begins must satisfy immediately. Without this
// the wait hangs for the full timeout waiting for a transition that already
// happened.
describe("decideInitial — screen sources", () => {
  test("via screen: an already-matching screen satisfies immediately", () => {
    expect(
      decideInitial({
        request: request({ until: ["blocked"], via: "screen" }),
        current: { state: "working" },
        terminal: "blocked",
      }),
    ).toEqual({ _tag: "Satisfied", state: "blocked", via: "screen" })
  })

  test("via screen: the supervisor's own state cannot satisfy", () => {
    expect(
      decideInitial({
        request: request({ until: ["done"], via: "screen" }),
        current: { state: "done" },
        terminal: "working",
      }),
    ).toEqual({ _tag: "Pending" })
  })

  test("via supervisor: an already-matching screen cannot satisfy", () => {
    expect(
      decideInitial({
        request: request({ until: ["blocked"], via: "supervisor" }),
        current: { state: "working" },
        terminal: "blocked",
      }),
    ).toEqual({ _tag: "Pending" })
  })

  test("via either: the supervisor wins when both already match", () => {
    expect(
      decideInitial({
        request: request({ until: ["done", "idle"], via: "either" }),
        current: { state: "done" },
        terminal: "idle",
      }),
    ).toEqual({ _tag: "Satisfied", state: "done", via: "supervisor" })
  })

  test("via either: the screen satisfies when only it matches", () => {
    expect(
      decideInitial({
        request: request({ until: ["blocked"], via: "either" }),
        current: { state: "working" },
        terminal: "blocked",
      }),
    ).toEqual({ _tag: "Satisfied", state: "blocked", via: "screen" })
  })

  test("an unknown short is NotFound even when a screen classification exists", () => {
    expect(
      decideInitial({
        request: request({ until: ["idle"], via: "screen" }),
        current: undefined,
        terminal: "idle",
      }),
    ).toEqual({ _tag: "NotFound" })
  })

  test("no screen classification yet leaves a screen-only wait Pending", () => {
    expect(
      decideInitial({
        request: request({ until: ["idle"], via: "screen" }),
        current: { state: "working" },
        terminal: undefined,
      }),
    ).toEqual({ _tag: "Pending" })
  })
})

describe("decodeTerminalStateEvent", () => {
  test("decodes a session-scoped record, mapping id onto short", () => {
    expect(
      decodeTerminalStateEvent({
        scope: "session",
        id: "ab12",
        state: "blocked",
        matcher: "permission-prompt",
        evidence: "Do you want to proceed?",
        at: "2026-07-28T00:00:00.000Z",
      }),
    ).toEqual({ kind: "terminal", short: "ab12", state: "blocked" })
  })

  // The poller classifies four scopes; only "session" records name a roster
  // short, so the other three cannot be matched against a wait target.
  test.each(["global", "orchestrator", "project"])("drops the %s scope", (scope) => {
    expect(decodeTerminalStateEvent({ scope, id: "ab12", state: "blocked" })).toBeUndefined()
  })

  test("returns undefined for an unknown screen state — including unknown itself", () => {
    expect(
      decodeTerminalStateEvent({ scope: "session", id: "ab12", state: "unknown" }),
    ).toBeUndefined()
    expect(
      decodeTerminalStateEvent({ scope: "session", id: "ab12", state: "done" }),
    ).toBeUndefined()
    expect(decodeTerminalStateEvent({ scope: "session", id: "ab12", state: 3 })).toBeUndefined()
  })

  test("returns undefined for a non-object payload", () => {
    expect(decodeTerminalStateEvent("nope")).toBeUndefined()
    expect(decodeTerminalStateEvent(null)).toBeUndefined()
    expect(decodeTerminalStateEvent(undefined)).toBeUndefined()
  })

  test("returns undefined when id is missing or empty", () => {
    expect(decodeTerminalStateEvent({ scope: "session", state: "idle" })).toBeUndefined()
    expect(decodeTerminalStateEvent({ scope: "session", id: "", state: "idle" })).toBeUndefined()
    expect(decodeTerminalStateEvent({ scope: "session", id: 42, state: "idle" })).toBeUndefined()
  })
})

describe("decodeSessionStateEvent", () => {
  test("decodes a well-formed session.state payload", () => {
    const event = decodeSessionStateEvent({ short: "ab12", sessionId: "sess-1", state: "done" })
    expect(event).toEqual({ kind: "state", short: "ab12", sessionId: "sess-1", state: "done" })
  })

  test("treats a missing sessionId as undefined rather than rejecting", () => {
    const event = decodeSessionStateEvent({ short: "ab12", state: "done" })
    expect(event).toEqual({ kind: "state", short: "ab12", sessionId: undefined, state: "done" })
  })

  test("returns undefined for a non-object payload", () => {
    expect(decodeSessionStateEvent("nope")).toBeUndefined()
    expect(decodeSessionStateEvent(null)).toBeUndefined()
    expect(decodeSessionStateEvent(undefined)).toBeUndefined()
  })

  test("returns undefined when short is missing or empty", () => {
    expect(decodeSessionStateEvent({ state: "done" })).toBeUndefined()
    expect(decodeSessionStateEvent({ short: "", state: "done" })).toBeUndefined()
  })

  test("returns undefined when state is missing or unknown", () => {
    expect(decodeSessionStateEvent({ short: "ab12" })).toBeUndefined()
    expect(decodeSessionStateEvent({ short: "ab12", state: "vibing" })).toBeUndefined()
    expect(decodeSessionStateEvent({ short: "ab12", state: 42 })).toBeUndefined()
  })
})

describe("decodeSessionRemovedEvent", () => {
  test("decodes a well-formed session.removed payload", () => {
    expect(decodeSessionRemovedEvent({ short: "ab12" })).toEqual({ kind: "removed", short: "ab12" })
  })

  test("returns undefined for a non-object payload", () => {
    expect(decodeSessionRemovedEvent("nope")).toBeUndefined()
    expect(decodeSessionRemovedEvent(null)).toBeUndefined()
  })

  test("returns undefined when short is missing or empty", () => {
    expect(decodeSessionRemovedEvent({})).toBeUndefined()
    expect(decodeSessionRemovedEvent({ short: "" })).toBeUndefined()
    expect(decodeSessionRemovedEvent({ short: 42 })).toBeUndefined()
  })
})
