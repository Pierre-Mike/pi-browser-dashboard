import { describe, expect, test } from "bun:test"
import { Either } from "effect"
import {
  type KeysRequestError,
  MAX_REPEAT,
  MAX_RESOLVED_KEYS_LENGTH,
  MAX_SEQUENCE_STEPS,
  parseKeysRequest,
} from "./sessions-keys.core"

// Shared assertion for the reject cases below: parsing must fail, tagged
// with the expected KeysRequestError._tag.
const expectRejected = ({ raw, tag }: { raw: unknown; tag: KeysRequestError["_tag"] }): void => {
  const out = parseKeysRequest(raw)
  expect(Either.isLeft(out)).toBe(true)
  if (Either.isLeft(out)) expect(out.left._tag).toBe(tag)
}

const expectResolved = ({
  raw,
  keys,
  resolved,
}: {
  raw: unknown
  keys: string
  resolved: readonly string[]
}): void => {
  const out = parseKeysRequest(raw)
  expect(Either.isRight(out)).toBe(true)
  if (Either.isRight(out)) expect(out.right).toEqual({ keys, resolved })
}

describe("parseKeysRequest — named key byte mapping", () => {
  test("escape", () => {
    expectResolved({ raw: { sequence: [{ named: "escape" }] }, keys: "\x1b", resolved: ["escape"] })
  })

  test("enter", () => {
    expectResolved({ raw: { sequence: [{ named: "enter" }] }, keys: "\r", resolved: ["enter"] })
  })

  test("tab", () => {
    expectResolved({ raw: { sequence: [{ named: "tab" }] }, keys: "\t", resolved: ["tab"] })
  })

  test("shift-tab", () => {
    expectResolved({
      raw: { sequence: [{ named: "shift-tab" }] },
      keys: "\x1b[Z",
      resolved: ["shift-tab"],
    })
  })

  test("up", () => {
    expectResolved({ raw: { sequence: [{ named: "up" }] }, keys: "\x1b[A", resolved: ["up"] })
  })

  test("down", () => {
    expectResolved({ raw: { sequence: [{ named: "down" }] }, keys: "\x1b[B", resolved: ["down"] })
  })

  test("right", () => {
    expectResolved({ raw: { sequence: [{ named: "right" }] }, keys: "\x1b[C", resolved: ["right"] })
  })

  test("left", () => {
    expectResolved({ raw: { sequence: [{ named: "left" }] }, keys: "\x1b[D", resolved: ["left"] })
  })

  test("home", () => {
    expectResolved({ raw: { sequence: [{ named: "home" }] }, keys: "\x1b[H", resolved: ["home"] })
  })

  test("end", () => {
    expectResolved({ raw: { sequence: [{ named: "end" }] }, keys: "\x1b[F", resolved: ["end"] })
  })

  test("page-up", () => {
    expectResolved({
      raw: { sequence: [{ named: "page-up" }] },
      keys: "\x1b[5~",
      resolved: ["page-up"],
    })
  })

  test("page-down", () => {
    expectResolved({
      raw: { sequence: [{ named: "page-down" }] },
      keys: "\x1b[6~",
      resolved: ["page-down"],
    })
  })

  test("backspace", () => {
    expectResolved({
      raw: { sequence: [{ named: "backspace" }] },
      keys: "\x7f",
      resolved: ["backspace"],
    })
  })

  test("delete", () => {
    expectResolved({
      raw: { sequence: [{ named: "delete" }] },
      keys: "\x1b[3~",
      resolved: ["delete"],
    })
  })

  test("space", () => {
    expectResolved({ raw: { sequence: [{ named: "space" }] }, keys: " ", resolved: ["space"] })
  })
})

describe("parseKeysRequest — deliberate exclusions", () => {
  test("rejects ctrl-z as an unknown name (it is sendViaPool's DETACH_KEY)", () => {
    expectRejected({ raw: { sequence: [{ named: "ctrl-z" }] }, tag: "BadStep" })
  })

  test("rejects ctrl-c as an unknown name (POST /:id/stop is the supported path)", () => {
    expectRejected({ raw: { sequence: [{ named: "ctrl-c" }] }, tag: "BadStep" })
  })
})

describe("parseKeysRequest — sequence-level validation", () => {
  test("rejects a non-object body", () => {
    expectRejected({ raw: "nope", tag: "BadSequence" })
  })

  test("rejects a missing sequence", () => {
    expectRejected({ raw: {}, tag: "BadSequence" })
  })

  test("rejects a non-array sequence", () => {
    expectRejected({ raw: { sequence: "enter" }, tag: "BadSequence" })
  })

  test("rejects an empty sequence", () => {
    expectRejected({ raw: { sequence: [] }, tag: "BadSequence" })
  })

  test("rejects a sequence over the step cap", () => {
    const sequence = Array.from({ length: MAX_SEQUENCE_STEPS + 1 }, () => ({ named: "down" }))
    expectRejected({ raw: { sequence }, tag: "BadSequence" })
  })

  test("accepts a sequence at exactly the step cap", () => {
    const sequence = Array.from({ length: MAX_SEQUENCE_STEPS }, () => ({ named: "down" }))
    const out = parseKeysRequest({ sequence })
    expect(Either.isRight(out)).toBe(true)
    if (Either.isRight(out)) expect(out.right.resolved).toHaveLength(MAX_SEQUENCE_STEPS)
  })
})

describe("parseKeysRequest — step validation", () => {
  test("rejects a non-object step", () => {
    expectRejected({ raw: { sequence: ["enter"] }, tag: "BadStep" })
  })

  test("rejects a step with neither named nor text", () => {
    expectRejected({ raw: { sequence: [{}] }, tag: "BadStep" })
  })

  test("rejects a step with both named and text", () => {
    expectRejected({ raw: { sequence: [{ named: "enter", text: "x" }] }, tag: "BadStep" })
  })

  test("rejects an unknown named key", () => {
    expectRejected({ raw: { sequence: [{ named: "vibing" }] }, tag: "BadStep" })
  })

  test("rejects an empty text", () => {
    expectRejected({ raw: { sequence: [{ text: "" }] }, tag: "BadStep" })
  })

  test("rejects a non-string text", () => {
    expectRejected({ raw: { sequence: [{ text: 42 }] }, tag: "BadStep" })
  })

  test("rejects text containing a control character", () => {
    expectRejected({ raw: { sequence: [{ text: "hi\x1b" }] }, tag: "BadStep" })
  })

  test("rejects text containing a newline", () => {
    expectRejected({ raw: { sequence: [{ text: "hi\n" }] }, tag: "BadStep" })
  })
})

describe("parseKeysRequest — repeat", () => {
  test("defaults repeat to 1", () => {
    expectResolved({ raw: { sequence: [{ named: "down" }] }, keys: "\x1b[B", resolved: ["down"] })
  })

  test("expands repeat into one trail entry per repetition", () => {
    expectResolved({
      raw: { sequence: [{ named: "down", repeat: 2 }, { named: "enter" }] },
      keys: "\x1b[B\x1b[B\r",
      resolved: ["down", "down", "enter"],
    })
  })

  test("accepts repeat at exactly the max", () => {
    const out = parseKeysRequest({ sequence: [{ named: "down", repeat: MAX_REPEAT }] })
    expect(Either.isRight(out)).toBe(true)
    if (Either.isRight(out)) {
      expect(out.right.keys).toBe("\x1b[B".repeat(MAX_REPEAT))
      expect(out.right.resolved).toHaveLength(MAX_REPEAT)
    }
  })

  test("rejects repeat over the max", () => {
    expectRejected({
      raw: { sequence: [{ named: "down", repeat: MAX_REPEAT + 1 }] },
      tag: "BadStep",
    })
  })

  test("rejects a zero repeat", () => {
    expectRejected({ raw: { sequence: [{ named: "down", repeat: 0 }] }, tag: "BadStep" })
  })

  test("rejects a negative repeat", () => {
    expectRejected({ raw: { sequence: [{ named: "down", repeat: -1 }] }, tag: "BadStep" })
  })

  test("rejects a non-integer repeat", () => {
    expectRejected({ raw: { sequence: [{ named: "down", repeat: 1.5 }] }, tag: "BadStep" })
  })

  test("rejects a non-numeric repeat", () => {
    expectRejected({ raw: { sequence: [{ named: "down", repeat: "two" }] }, tag: "BadStep" })
  })
})

describe("parseKeysRequest — text steps", () => {
  test("resolves literal text and quotes it in the trail", () => {
    expectResolved({
      raw: { sequence: [{ text: "hello" }] },
      keys: "hello",
      resolved: ['"hello"'],
    })
  })

  test("mixes text and named steps in order", () => {
    expectResolved({
      raw: { sequence: [{ text: "hello" }, { named: "enter" }] },
      keys: "hello\r",
      resolved: ['"hello"', "enter"],
    })
  })
})

describe("parseKeysRequest — resolved byte cap", () => {
  test("accepts resolved keys at exactly the cap", () => {
    const text = "x".repeat(MAX_RESOLVED_KEYS_LENGTH)
    const out = parseKeysRequest({ sequence: [{ text }] })
    expect(Either.isRight(out)).toBe(true)
    if (Either.isRight(out)) expect(out.right.keys).toHaveLength(MAX_RESOLVED_KEYS_LENGTH)
  })

  test("rejects resolved keys over the cap", () => {
    const text = "x".repeat(MAX_RESOLVED_KEYS_LENGTH + 1)
    expectRejected({ raw: { sequence: [{ text }] }, tag: "TooLong" })
  })
})
