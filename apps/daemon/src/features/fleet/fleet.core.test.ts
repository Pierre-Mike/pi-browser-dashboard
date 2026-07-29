import { describe, expect, it } from "bun:test"
import { WAIT_TIMEOUT_MAX_MS } from "@pid/shared"
import { Either } from "effect"
import { type Fleet, type FleetStep, MAX_STEP_N, parseFleetFile, planFleetRun } from "./fleet.core"

const errorsOf = (
  raw: unknown,
): readonly { fleet: string; step: string | undefined; message: string }[] => {
  const result = parseFleetFile(raw)
  if (Either.isRight(result)) throw new Error("expected parseFleetFile to fail")
  return result.left
}

const messagesOf = (raw: unknown): readonly string[] => errorsOf(raw).map((e) => e.message)

const VALID_FILE = {
  fleets: [
    {
      name: "review-and-fix",
      description: "three reviewers, then one fixer",
      steps: [
        { id: "review", intent: "review the working diff for bugs", n: 3, agent: "reviewer" },
        {
          id: "fix",
          intent: "fix what the reviewers found",
          needs: ["review"],
          until: ["done"],
          timeoutMs: 600_000,
        },
      ],
    },
  ],
}

describe("parseFleetFile — happy path", () => {
  it("parses a valid file into a FleetFile with defaults filled in", () => {
    const result = parseFleetFile(VALID_FILE)
    expect(Either.isRight(result)).toBe(true)
    if (Either.isLeft(result)) return
    expect(result.right.fleets).toHaveLength(1)
    const fleet = result.right.fleets[0] as Fleet
    expect(fleet.name).toBe("review-and-fix")
    expect(fleet.description).toBe("three reviewers, then one fixer")
    expect(fleet.steps).toEqual([
      {
        id: "review",
        intent: "review the working diff for bugs",
        n: 3,
        agent: "reviewer",
        cwd: undefined,
        needs: [],
        until: undefined,
        timeoutMs: undefined,
      },
      {
        id: "fix",
        intent: "fix what the reviewers found",
        n: 1,
        agent: undefined,
        cwd: undefined,
        needs: ["review"],
        until: ["done"],
        timeoutMs: 600_000,
      },
    ])
  })

  it("allows a file with zero fleets", () => {
    expect(parseFleetFile({ fleets: [] })).toEqual(Either.right({ fleets: [] }))
  })

  it("defaults n to 1 and description to undefined when omitted", () => {
    const result = parseFleetFile({
      fleets: [{ name: "solo", steps: [{ id: "only", intent: "do a thing" }] }],
    })
    expect(Either.isRight(result)).toBe(true)
    if (Either.isLeft(result)) return
    expect(result.right.fleets[0]).toEqual({
      name: "solo",
      description: undefined,
      steps: [
        {
          id: "only",
          intent: "do a thing",
          n: 1,
          agent: undefined,
          cwd: undefined,
          needs: [],
          until: undefined,
          timeoutMs: undefined,
        },
      ],
    })
  })

  it("ignores a wrong-typed description rather than erroring (presentation-only)", () => {
    const result = parseFleetFile({
      fleets: [{ name: "solo", description: 42, steps: [{ id: "a", intent: "x" }] }],
    })
    expect(Either.isRight(result)).toBe(true)
    if (Either.isLeft(result)) return
    expect(result.right.fleets[0]?.description).toBeUndefined()
  })
})

describe("parseFleetFile — root shape", () => {
  it("rejects a non-object root", () => {
    expect(messagesOf(null)).toEqual(["root must be an object with a `fleets` array"])
    expect(messagesOf("nope")).toEqual(["root must be an object with a `fleets` array"])
    expect(messagesOf([])).toEqual(["root must be an object with a `fleets` array"])
  })

  it("rejects a root object missing a fleets array", () => {
    expect(messagesOf({})).toEqual(["root must be an object with a `fleets` array"])
    expect(messagesOf({ fleets: "nope" })).toEqual(["root must be an object with a `fleets` array"])
  })

  it("rejects a non-object fleet entry, labeled by position", () => {
    const errors = errorsOf({ fleets: ["nope"] })
    expect(errors).toEqual([
      { fleet: "fleet #1", step: undefined, message: "fleet must be an object" },
    ])
  })
})

describe("parseFleetFile — fleet-level validation", () => {
  it("requires a non-empty fleet name", () => {
    const errors = errorsOf({ fleets: [{ steps: [{ id: "a", intent: "x" }] }] })
    expect(errors).toContainEqual({
      fleet: "fleet #1",
      step: undefined,
      message: "fleet name must be a non-empty string",
    })
  })

  it("requires a non-empty steps array", () => {
    expect(errorsOf({ fleets: [{ name: "empty", steps: [] }] })).toEqual([
      { fleet: "empty", step: undefined, message: "steps must be a non-empty array" },
    ])
    expect(errorsOf({ fleets: [{ name: "missing" }] })).toEqual([
      { fleet: "missing", step: undefined, message: "steps must be a non-empty array" },
    ])
  })

  it("reports every duplicate fleet name, not just the second occurrence", () => {
    const errors = errorsOf({
      fleets: [
        { name: "dup", steps: [{ id: "a", intent: "x" }] },
        { name: "dup", steps: [{ id: "a", intent: "x" }] },
      ],
    })
    expect(errors.filter((e) => e.message === 'duplicate fleet name: "dup"')).toHaveLength(2)
  })

  it("collects errors across multiple fleets in one pass", () => {
    const errors = errorsOf({
      fleets: [{ steps: [] }, { name: "second", steps: [{ id: "", intent: "x" }] }],
    })
    expect(errors).toContainEqual({
      fleet: "fleet #1",
      step: undefined,
      message: "steps must be a non-empty array",
    })
    expect(errors).toContainEqual({
      fleet: "fleet #1",
      step: undefined,
      message: "fleet name must be a non-empty string",
    })
    expect(errors).toContainEqual({
      fleet: "second",
      step: "step #1",
      message: "id must be a non-empty string",
    })
  })
})

describe("parseFleetFile — per-step field validation", () => {
  const oneStep = (step: unknown) => ({ fleets: [{ name: "f", steps: [step] }] })

  it("rejects a non-object step", () => {
    expect(errorsOf(oneStep("nope"))).toEqual([
      { fleet: "f", step: "step #1", message: "step must be an object" },
    ])
  })

  it("requires a non-empty id", () => {
    expect(messagesOf(oneStep({ id: "", intent: "x" }))).toContain("id must be a non-empty string")
    expect(messagesOf(oneStep({ intent: "x" }))).toContain("id must be a non-empty string")
  })

  it("requires a non-empty intent", () => {
    expect(messagesOf(oneStep({ id: "a", intent: "" }))).toContain(
      "intent must be a non-empty string",
    )
    expect(messagesOf(oneStep({ id: "a" }))).toContain("intent must be a non-empty string")
  })

  it(`caps n at ${MAX_STEP_N} and requires a positive integer`, () => {
    expect(messagesOf(oneStep({ id: "a", intent: "x", n: 0 }))).toContain(
      `n must be an integer between 1 and ${MAX_STEP_N}`,
    )
    expect(messagesOf(oneStep({ id: "a", intent: "x", n: 1.5 }))).toContain(
      `n must be an integer between 1 and ${MAX_STEP_N}`,
    )
    expect(messagesOf(oneStep({ id: "a", intent: "x", n: MAX_STEP_N + 1 }))).toContain(
      `n must be an integer between 1 and ${MAX_STEP_N}`,
    )
    expect(messagesOf(oneStep({ id: "a", intent: "x", n: "3" }))).toContain(
      `n must be an integer between 1 and ${MAX_STEP_N}`,
    )
    expect(Either.isRight(parseFleetFile(oneStep({ id: "a", intent: "x", n: MAX_STEP_N })))).toBe(
      true,
    )
  })

  it("rejects wrong-typed agent/cwd", () => {
    expect(messagesOf(oneStep({ id: "a", intent: "x", agent: 1 }))).toContain(
      "agent must be a non-empty string",
    )
    expect(messagesOf(oneStep({ id: "a", intent: "x", cwd: "" }))).toContain(
      "cwd must be a non-empty string",
    )
  })

  it("requires needs to be an array of non-empty strings", () => {
    expect(messagesOf(oneStep({ id: "a", intent: "x", needs: "review" }))).toContain(
      "needs must be an array of non-empty step ids",
    )
    expect(messagesOf(oneStep({ id: "a", intent: "x", needs: [1] }))).toContain(
      "needs must be an array of non-empty step ids",
    )
  })

  it("requires until to be a non-empty array of known state slugs", () => {
    expect(messagesOf(oneStep({ id: "a", intent: "x", until: [] }))).toContain(
      "until must be a non-empty array of session states",
    )
    expect(messagesOf(oneStep({ id: "a", intent: "x", until: ["nope"] }))).toContain(
      'until contains an unknown state: "nope"',
    )
    expect(
      Either.isRight(parseFleetFile(oneStep({ id: "a", intent: "x", until: ["done", "failed"] }))),
    ).toBe(true)
  })

  it("requires timeoutMs within the wait primitive's bounds", () => {
    expect(messagesOf(oneStep({ id: "a", intent: "x", until: ["done"], timeoutMs: 0 }))).toContain(
      `timeoutMs must be an integer between 1 and ${WAIT_TIMEOUT_MAX_MS}`,
    )
    expect(
      messagesOf(
        oneStep({ id: "a", intent: "x", until: ["done"], timeoutMs: WAIT_TIMEOUT_MAX_MS + 1 }),
      ),
    ).toContain(`timeoutMs must be an integer between 1 and ${WAIT_TIMEOUT_MAX_MS}`)
  })

  it("rejects timeoutMs without until", () => {
    expect(messagesOf(oneStep({ id: "a", intent: "x", timeoutMs: 1000 }))).toContain(
      "timeoutMs requires until to be set",
    )
  })

  it("collects every field error on a step, not just the first", () => {
    const errors = errorsOf(oneStep({ id: "", intent: "", n: -1 }))
    expect(errors).toHaveLength(3)
  })
})

describe("parseFleetFile — structural checks", () => {
  it("reports duplicate step ids", () => {
    const errors = errorsOf({
      fleets: [
        {
          name: "f",
          steps: [
            { id: "a", intent: "x" },
            { id: "a", intent: "y" },
          ],
        },
      ],
    })
    expect(errors).toEqual([{ fleet: "f", step: "a", message: 'duplicate step id: "a"' }])
  })

  it("reports an unknown needs reference", () => {
    const errors = errorsOf({
      fleets: [{ name: "f", steps: [{ id: "a", intent: "x", needs: ["ghost"] }] }],
    })
    expect(errors).toEqual([{ fleet: "f", step: "a", message: 'needs unknown step: "ghost"' }])
  })

  it("collects a duplicate id AND an unknown needs reference together", () => {
    const errors = errorsOf({
      fleets: [
        {
          name: "f",
          steps: [
            { id: "a", intent: "x" },
            { id: "a", intent: "y", needs: ["ghost"] },
          ],
        },
      ],
    })
    expect(errors).toContainEqual({ fleet: "f", step: "a", message: 'duplicate step id: "a"' })
    expect(errors).toContainEqual({ fleet: "f", step: "a", message: 'needs unknown step: "ghost"' })
  })

  it("does not scope needs existence to a step referencing itself", () => {
    // A step may not depend on itself in practice (it would always be a
    // 1-node cycle) — this is exercised end-to-end by the cycle test below.
    const errors = errorsOf({
      fleets: [{ name: "f", steps: [{ id: "a", intent: "x", needs: ["a"] }] }],
    })
    expect(errors).toEqual([
      { fleet: "f", step: undefined, message: "dependency cycle detected among steps: a" },
    ])
  })

  it("rejects a cycle across two steps", () => {
    const errors = errorsOf({
      fleets: [
        {
          name: "f",
          steps: [
            { id: "a", intent: "x", needs: ["b"] },
            { id: "b", intent: "y", needs: ["a"] },
          ],
        },
      ],
    })
    expect(errors).toEqual([
      { fleet: "f", step: undefined, message: "dependency cycle detected among steps: a, b" },
    ])
  })
})

// --- planFleetRun -------------------------------------------------------------

const step = (over: Partial<FleetStep> & { readonly id: string }): FleetStep => ({
  intent: "do it",
  n: 1,
  agent: undefined,
  cwd: undefined,
  needs: [],
  until: undefined,
  timeoutMs: undefined,
  ...over,
})

const fleet = (steps: readonly FleetStep[]): Fleet => ({ name: "f", description: undefined, steps })

describe("planFleetRun", () => {
  it("groups fully independent steps into a single wave", () => {
    const result = planFleetRun({
      fleet: fleet([step({ id: "a" }), step({ id: "b" }), step({ id: "c" })]),
    })
    expect(result).toEqual(Either.right([["a", "b", "c"]]))
  })

  it("orders a single chain into one wave per link", () => {
    const result = planFleetRun({
      fleet: fleet([
        step({ id: "a" }),
        step({ id: "b", needs: ["a"] }),
        step({ id: "c", needs: ["b"] }),
      ]),
    })
    expect(result).toEqual(Either.right([["a"], ["b"], ["c"]]))
  })

  it("resolves a diamond into three waves", () => {
    const result = planFleetRun({
      fleet: fleet([
        step({ id: "a" }),
        step({ id: "b", needs: ["a"] }),
        step({ id: "c", needs: ["a"] }),
        step({ id: "d", needs: ["b", "c"] }),
      ]),
    })
    expect(result).toEqual(Either.right([["a"], ["b", "c"], ["d"]]))
  })

  it("fails with every step involved in a cycle", () => {
    const result = planFleetRun({
      fleet: fleet([
        step({ id: "a", needs: ["c"] }),
        step({ id: "b", needs: ["a"] }),
        step({ id: "c", needs: ["b"] }),
      ]),
    })
    expect(result).toEqual(
      Either.left({
        fleet: "f",
        step: undefined,
        message: "dependency cycle detected among steps: a, b, c",
      }),
    )
  })

  it("isolates a cycle from unrelated independent steps", () => {
    const result = planFleetRun({
      fleet: fleet([
        step({ id: "independent" }),
        step({ id: "a", needs: ["b"] }),
        step({ id: "b", needs: ["a"] }),
      ]),
    })
    expect(result).toEqual(
      Either.left({
        fleet: "f",
        step: undefined,
        message: "dependency cycle detected among steps: a, b",
      }),
    )
  })
})
