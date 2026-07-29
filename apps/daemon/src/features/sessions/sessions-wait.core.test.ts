import { describe, expect, test } from "bun:test"
import { WAIT_TIMEOUT_DEFAULT_MS, WAIT_TIMEOUT_MAX_MS } from "@pid/shared"
import { Either } from "effect"
import {
  decideInitial,
  decodeSessionRemovedEvent,
  decodeSessionStateEvent,
  evaluateWaitEvent,
  parseWaitRequest,
  type WaitRequest,
} from "./sessions-wait.core"

// Shared assertion for the reject cases below: parsing must fail, tagged
// with the expected WaitRequestError._tag.
const expectRejected = ({ raw, tag }: { raw: unknown; tag: "BadUntil" | "BadTimeout" }): void => {
  const out = parseWaitRequest(raw)
  expect(Either.isLeft(out)).toBe(true)
  if (Either.isLeft(out)) expect(out.left._tag).toBe(tag)
}

describe("parseWaitRequest", () => {
  test("accepts a single known state and applies the default timeout", () => {
    const out = parseWaitRequest({ until: ["done"] })
    expect(Either.isRight(out)).toBe(true)
    if (Either.isRight(out)) {
      expect(out.right).toEqual({ until: ["done"], timeoutMs: WAIT_TIMEOUT_DEFAULT_MS })
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
})

const request = (overrides: Partial<WaitRequest> = {}): WaitRequest => ({
  until: ["done", "failed"],
  timeoutMs: WAIT_TIMEOUT_DEFAULT_MS,
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
    expect(decision).toEqual({ _tag: "Satisfied", state: "done" })
  })

  test("does not report a change when the event carries no sessionId", () => {
    const decision = evaluateWaitEvent({
      request: request(),
      target: { short: "ab12", sessionId: "sess-1" },
      event: { kind: "state", short: "ab12", sessionId: undefined, state: "done" },
    })
    expect(decision).toEqual({ _tag: "Satisfied", state: "done" })
  })

  test("reports Satisfied when the same occupant reaches an awaited state", () => {
    const decision = evaluateWaitEvent({
      request: request(),
      target: { short: "ab12", sessionId: "sess-1" },
      event: { kind: "state", short: "ab12", sessionId: "sess-1", state: "failed" },
    })
    expect(decision).toEqual({ _tag: "Satisfied", state: "failed" })
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
    expect(decideInitial({ request: request(), current: undefined })).toEqual({ _tag: "NotFound" })
  })

  test("reports Satisfied when the current state is already in the awaited list", () => {
    expect(decideInitial({ request: request(), current: { state: "done" } })).toEqual({
      _tag: "Satisfied",
      state: "done",
    })
  })

  test("reports Pending when the current state is not yet awaited", () => {
    expect(decideInitial({ request: request(), current: { state: "working" } })).toEqual({
      _tag: "Pending",
    })
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
