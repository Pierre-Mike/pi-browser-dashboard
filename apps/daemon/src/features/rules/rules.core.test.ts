import { describe, expect, it } from "bun:test"
import { Either } from "effect"
import {
  ageMs,
  applyStateEvent,
  CEILING_MAX_ACTIONS_PER_SESSION,
  CEILING_WINDOW_MS,
  computeStale,
  DEFAULT_COOLDOWN_MS,
  decodeSessionRemovedPayload,
  decodeSessionStatePayload,
  evaluate,
  type FiringRecord,
  parseRulesFile,
  type Rule,
  type RulesFile,
  type SessionSnapshot,
} from "./rules.core"

const errorsOf = (raw: unknown): readonly { rule: string; message: string }[] => {
  const result = parseRulesFile(raw)
  if (Either.isRight(result)) throw new Error("expected parseRulesFile to fail")
  return result.left
}

const messagesOf = (raw: unknown): readonly string[] => errorsOf(raw).map((e) => e.message)

const VALID_FILE = {
  enabled: true,
  rules: [
    {
      name: "notify-on-blocked",
      when: { state: "blocked" },
      do: { action: "notify", message: "session is blocked" },
    },
  ],
}

describe("parseRulesFile — happy path", () => {
  it("parses a valid file into a RulesFile with defaults filled in", () => {
    const result = parseRulesFile(VALID_FILE)
    expect(Either.isRight(result)).toBe(true)
    if (Either.isLeft(result)) return
    expect(result.right).toEqual({
      enabled: true,
      rules: [
        {
          name: "notify-on-blocked",
          enabled: true,
          when: { state: "blocked", forMs: undefined, harness: undefined, stale: undefined },
          do: { action: "notify", message: "session is blocked" },
          cooldownMs: DEFAULT_COOLDOWN_MS,
        },
      ],
    })
  })

  it("defaults enabled to false and rules to [] for an empty object", () => {
    expect(parseRulesFile({})).toEqual(Either.right({ enabled: false, rules: [] }))
  })

  it("allows a file with zero rules but enabled: true", () => {
    expect(parseRulesFile({ enabled: true, rules: [] })).toEqual(
      Either.right({ enabled: true, rules: [] }),
    )
  })

  it("parses a full rule with every optional field set", () => {
    const result = parseRulesFile({
      enabled: true,
      rules: [
        {
          name: "page-on-stuck-blocked",
          enabled: false,
          when: { state: "blocked", forMs: 60_000, harness: "claude", stale: true },
          do: { action: "keys", sequence: ["down", "enter"], confirm: true },
          cooldownMs: 120_000,
        },
      ],
    })
    expect(Either.isRight(result)).toBe(true)
    if (Either.isLeft(result)) return
    expect(result.right.rules[0]).toEqual({
      name: "page-on-stuck-blocked",
      enabled: false,
      when: { state: "blocked", forMs: 60_000, harness: "claude", stale: true },
      do: { action: "keys", sequence: ["down", "enter"], confirm: true },
      cooldownMs: 120_000,
    })
  })
})

describe("parseRulesFile — root shape", () => {
  it("rejects a non-object root", () => {
    expect(messagesOf(null)).toEqual(["root must be an object"])
    expect(messagesOf([])).toEqual(["root must be an object"])
    expect(messagesOf("nope")).toEqual(["root must be an object"])
  })

  it("rejects a wrong-typed enabled field", () => {
    expect(messagesOf({ enabled: "yes" })).toEqual(["enabled must be a boolean"])
  })

  it("rejects a non-array rules field", () => {
    expect(messagesOf({ rules: "nope" })).toEqual(["rules must be an array"])
  })
})

describe("parseRulesFile — rule fields", () => {
  it("rejects a missing name", () => {
    expect(messagesOf({ rules: [{ when: { state: "blocked" }, do: { action: "stop" } }] })).toEqual(
      ["name must be a non-empty string"],
    )
  })

  it("rejects a wrong-typed enabled", () => {
    expect(
      messagesOf({
        rules: [{ name: "r", enabled: "yes", when: { state: "blocked" }, do: { action: "stop" } }],
      }),
    ).toEqual(["enabled must be a boolean"])
  })

  it("rejects a missing when object", () => {
    expect(messagesOf({ rules: [{ name: "r", do: { action: "stop" } }] })).toEqual([
      "when must be an object",
    ])
  })

  it("rejects an unknown when.state", () => {
    expect(
      messagesOf({ rules: [{ name: "r", when: { state: "working" }, do: { action: "stop" } }] }),
    ).toEqual([expect.stringContaining("when.state must be one of")])
  })

  it("rejects an out-of-range when.forMs", () => {
    expect(
      messagesOf({
        rules: [{ name: "r", when: { state: "blocked", forMs: 0 }, do: { action: "stop" } }],
      }),
    ).toEqual([expect.stringContaining("when.forMs must be an integer")])
  })

  it("rejects an unknown when.harness", () => {
    expect(
      messagesOf({
        rules: [
          { name: "r", when: { state: "blocked", harness: "codex" }, do: { action: "stop" } },
        ],
      }),
    ).toEqual([expect.stringContaining("when.harness must be one of")])
  })

  it("rejects a wrong-typed when.stale", () => {
    expect(
      messagesOf({
        rules: [{ name: "r", when: { state: "blocked", stale: "yes" }, do: { action: "stop" } }],
      }),
    ).toEqual(["when.stale must be a boolean"])
  })

  it("rejects a missing do object", () => {
    expect(messagesOf({ rules: [{ name: "r", when: { state: "blocked" } }] })).toEqual([
      "do must be an object",
    ])
  })

  it("rejects an unknown do.action", () => {
    expect(
      messagesOf({ rules: [{ name: "r", when: { state: "blocked" }, do: { action: "explode" } }] }),
    ).toEqual([expect.stringContaining("do.action must be one of")])
  })

  it("rejects a notify action with no message", () => {
    expect(
      messagesOf({
        rules: [{ name: "r", when: { state: "blocked" }, do: { action: "notify" } }],
      }),
    ).toEqual(["do.message must be a non-empty string for a notify action"])
  })

  it("rejects a keys action with an empty sequence", () => {
    expect(
      messagesOf({
        rules: [{ name: "r", when: { state: "blocked" }, do: { action: "keys", sequence: [] } }],
      }),
    ).toEqual(["do.sequence must be a non-empty array for a keys action"])
  })

  it("rejects a keys action with an unknown key name", () => {
    expect(
      messagesOf({
        rules: [
          {
            name: "r",
            when: { state: "blocked" },
            do: { action: "keys", sequence: ["ctrl-c"] },
          },
        ],
      }),
    ).toEqual([expect.stringContaining("do.sequence contains an unknown key name")])
  })

  it("rejects a keys action with a wrong-typed confirm", () => {
    expect(
      messagesOf({
        rules: [
          {
            name: "r",
            when: { state: "blocked" },
            do: { action: "keys", sequence: ["enter"], confirm: "yes" },
          },
        ],
      }),
    ).toEqual(["do.confirm must be a boolean"])
  })

  it("rejects an out-of-range cooldownMs", () => {
    expect(
      messagesOf({
        rules: [{ name: "r", when: { state: "blocked" }, do: { action: "stop" }, cooldownMs: -1 }],
      }),
    ).toEqual([expect.stringContaining("cooldownMs must be an integer")])
  })

  it("rejects duplicate rule names", () => {
    const dup = {
      rules: [
        { name: "r", when: { state: "blocked" }, do: { action: "stop" } },
        { name: "r", when: { state: "done" }, do: { action: "stop" } },
      ],
    }
    expect(messagesOf(dup)).toEqual(['duplicate rule name: "r"'])
  })

  it("collects every error across every rule in one pass", () => {
    const errs = messagesOf({
      rules: [
        { when: { state: "blocked" }, do: { action: "stop" } },
        { name: "b", when: { state: "bogus" }, do: { action: "nope" } },
      ],
    })
    expect(errs.length).toBeGreaterThanOrEqual(2)
  })
})

// --- evaluate ------------------------------------------------------------------

const ruleOf = (overrides: Partial<Rule>): Rule => ({
  name: "r",
  enabled: true,
  when: { state: "blocked", forMs: undefined, harness: undefined, stale: undefined },
  do: { action: "notify", message: "hi" },
  cooldownMs: DEFAULT_COOLDOWN_MS,
  ...overrides,
})

const fileOf = (rules: readonly Rule[]): RulesFile => ({ enabled: true, rules })

const sessionOf = (overrides: Partial<SessionSnapshot>): SessionSnapshot => ({
  short: "ab12",
  state: "blocked",
  harness: "claude",
  stale: false,
  ...overrides,
})

describe("evaluate — matching", () => {
  it("fires on a transition into the target state", () => {
    const outcomes = evaluate({
      rules: fileOf([ruleOf({})]),
      session: sessionOf({}),
      prior: "working",
      dwellMs: 0,
      now: 1000,
      history: [],
    })
    expect(outcomes).toEqual([
      { _tag: "Fired", rule: "r", short: "ab12", action: { action: "notify", message: "hi" } },
    ])
  })

  it("does not fire on a no-op re-evaluation of an unchanged state (transition-only rule)", () => {
    const outcomes = evaluate({
      rules: fileOf([ruleOf({})]),
      session: sessionOf({}),
      prior: "blocked",
      dwellMs: 5000,
      now: 1000,
      history: [],
    })
    expect(outcomes).toEqual([])
  })

  it("a dwell condition does not match before forMs has elapsed, then does", () => {
    const rule = ruleOf({
      when: { state: "blocked", forMs: 60_000, harness: undefined, stale: undefined },
    })
    const notYet = evaluate({
      rules: fileOf([rule]),
      session: sessionOf({}),
      prior: "blocked",
      dwellMs: 10_000,
      now: 1000,
      history: [],
    })
    expect(notYet).toEqual([])
    const ripe = evaluate({
      rules: fileOf([rule]),
      session: sessionOf({}),
      prior: "blocked",
      dwellMs: 60_000,
      now: 1000,
      history: [],
    })
    expect(ripe).toEqual([
      { _tag: "Fired", rule: "r", short: "ab12", action: { action: "notify", message: "hi" } },
    ])
  })

  it("a rule that matches nothing produces no outcome and no error", () => {
    const outcomes = evaluate({
      rules: fileOf([
        ruleOf({ when: { state: "done", forMs: undefined, harness: undefined, stale: undefined } }),
      ]),
      session: sessionOf({ state: "blocked" }),
      prior: "working",
      dwellMs: 0,
      now: 1000,
      history: [],
    })
    expect(outcomes).toEqual([])
  })

  it("filters on harness", () => {
    const rule = ruleOf({
      when: { state: "blocked", forMs: undefined, harness: "pi", stale: undefined },
    })
    expect(
      evaluate({
        rules: fileOf([rule]),
        session: sessionOf({ harness: "claude" }),
        prior: "working",
        dwellMs: 0,
        now: 1000,
        history: [],
      }),
    ).toEqual([])
    expect(
      evaluate({
        rules: fileOf([rule]),
        session: sessionOf({ harness: "pi" }),
        prior: "working",
        dwellMs: 0,
        now: 1000,
        history: [],
      }),
    ).toHaveLength(1)
  })

  it("filters on the staleness verdict", () => {
    const rule = ruleOf({
      when: { state: "blocked", forMs: undefined, harness: undefined, stale: true },
    })
    expect(
      evaluate({
        rules: fileOf([rule]),
        session: sessionOf({ stale: false }),
        prior: "working",
        dwellMs: 0,
        now: 1000,
        history: [],
      }),
    ).toEqual([])
    expect(
      evaluate({
        rules: fileOf([rule]),
        session: sessionOf({ stale: true }),
        prior: "working",
        dwellMs: 0,
        now: 1000,
        history: [],
      }),
    ).toHaveLength(1)
  })
})

describe("evaluate — safety suppressions", () => {
  it("suppresses a disabled rule but still reports the match", () => {
    const outcomes = evaluate({
      rules: fileOf([ruleOf({ enabled: false })]),
      session: sessionOf({}),
      prior: "working",
      dwellMs: 0,
      now: 1000,
      history: [],
    })
    expect(outcomes).toEqual([
      {
        _tag: "Suppressed",
        rule: "r",
        short: "ab12",
        action: { action: "notify", message: "hi" },
        reason: { _tag: "Disabled" },
      },
    ])
  })

  it("suppresses a re-fire inside the rule's cooldown window", () => {
    const rule = ruleOf({ cooldownMs: 10_000 })
    const history: readonly FiringRecord[] = [{ rule: "r", short: "ab12", at: 995_000 }]
    const outcomes = evaluate({
      rules: fileOf([rule]),
      session: sessionOf({}),
      prior: "working",
      dwellMs: 0,
      now: 1_000_000,
      history,
    })
    expect(outcomes).toEqual([
      {
        _tag: "Suppressed",
        rule: "r",
        short: "ab12",
        action: { action: "notify", message: "hi" },
        reason: { _tag: "Cooldown", remainingMs: 5000 },
      },
    ])
  })

  it("fires again once the cooldown has fully elapsed", () => {
    const rule = ruleOf({ cooldownMs: 10_000 })
    const history: readonly FiringRecord[] = [{ rule: "r", short: "ab12", at: 989_000 }]
    const outcomes = evaluate({
      rules: fileOf([rule]),
      session: sessionOf({}),
      prior: "working",
      dwellMs: 0,
      now: 1_000_000,
      history,
    })
    expect(outcomes).toEqual([
      { _tag: "Fired", rule: "r", short: "ab12", action: { action: "notify", message: "hi" } },
    ])
  })

  it("suppresses once the per-session ceiling is reached, even across different rules", () => {
    const rules = fileOf([ruleOf({ name: "r1" }), ruleOf({ name: "r2" })])
    const history: readonly FiringRecord[] = Array.from(
      { length: CEILING_MAX_ACTIONS_PER_SESSION },
      (_, i) => ({ rule: `other-${i}`, short: "ab12", at: 1000 - i }),
    )
    const outcomes = evaluate({
      rules,
      session: sessionOf({}),
      prior: "working",
      dwellMs: 0,
      now: 1000 + CEILING_WINDOW_MS / 2,
      history,
    })
    expect(outcomes.every((o) => o._tag === "Suppressed" && o.reason._tag === "Ceiling")).toBe(true)
  })

  it("does not count a suppressed attempt toward the ceiling or cooldown", () => {
    // Only Fired records ever land in `history` in the real engine; this
    // documents that evaluate() itself never has to special-case that.
    const rule = ruleOf({})
    const outcomes = evaluate({
      rules: fileOf([rule]),
      session: sessionOf({}),
      prior: "working",
      dwellMs: 0,
      now: 1000,
      history: [],
    })
    expect(outcomes[0]?._tag).toBe("Fired")
  })

  it("suppresses a keys action with no per-rule confirm", () => {
    const rule = ruleOf({ do: { action: "keys", sequence: ["down", "enter"], confirm: false } })
    const outcomes = evaluate({
      rules: fileOf([rule]),
      session: sessionOf({}),
      prior: "working",
      dwellMs: 0,
      now: 1000,
      history: [],
    })
    expect(outcomes).toEqual([
      {
        _tag: "Suppressed",
        rule: "r",
        short: "ab12",
        action: { action: "keys", sequence: ["down", "enter"], confirm: false },
        reason: { _tag: "KeysNotConfirmed" },
      },
    ])
  })

  it("fires a keys action once confirm is true", () => {
    const rule = ruleOf({ do: { action: "keys", sequence: ["down", "enter"], confirm: true } })
    const outcomes = evaluate({
      rules: fileOf([rule]),
      session: sessionOf({}),
      prior: "working",
      dwellMs: 0,
      now: 1000,
      history: [],
    })
    expect(outcomes[0]?._tag).toBe("Fired")
  })

  it("evaluates a session matching two rules independently", () => {
    const rules = fileOf([ruleOf({ name: "r1" }), ruleOf({ name: "r2", enabled: false })])
    const outcomes = evaluate({
      rules,
      session: sessionOf({}),
      prior: "working",
      dwellMs: 0,
      now: 1000,
      history: [],
    })
    expect(outcomes).toEqual([
      { _tag: "Fired", rule: "r1", short: "ab12", action: { action: "notify", message: "hi" } },
      {
        _tag: "Suppressed",
        rule: "r2",
        short: "ab12",
        action: { action: "notify", message: "hi" },
        reason: { _tag: "Disabled" },
      },
    ])
  })
})

// --- bus-payload decoding -------------------------------------------------------

describe("decodeSessionStatePayload", () => {
  it("decodes a well-formed payload, defaulting harness to claude", () => {
    expect(
      decodeSessionStatePayload({ short: "ab12", state: "blocked", updatedAt: "2020-01-01" }),
    ).toEqual({
      short: "ab12",
      state: "blocked",
      harness: "claude",
      updatedAt: "2020-01-01",
    })
  })

  it("keeps harness: pi when present", () => {
    expect(
      decodeSessionStatePayload({ short: "ab12", state: "blocked", harness: "pi" })?.harness,
    ).toBe("pi")
  })

  it("rejects a payload missing short or with an unrecognized state", () => {
    expect(decodeSessionStatePayload({ state: "blocked" })).toBeUndefined()
    expect(decodeSessionStatePayload({ short: "ab12", state: "bogus" })).toBeUndefined()
    expect(decodeSessionStatePayload(null)).toBeUndefined()
  })
})

describe("decodeSessionRemovedPayload", () => {
  it("decodes a well-formed payload", () => {
    expect(decodeSessionRemovedPayload({ short: "ab12" })).toBe("ab12")
  })

  it("rejects a payload missing short", () => {
    expect(decodeSessionRemovedPayload({})).toBeUndefined()
    expect(decodeSessionRemovedPayload("nope")).toBeUndefined()
  })
})

// --- session-view bookkeeping ----------------------------------------------------

describe("applyStateEvent", () => {
  it("treats first sight of a session as a transition", () => {
    const result = applyStateEvent({
      existing: undefined,
      short: "ab12",
      state: "blocked",
      harness: "claude",
      updatedAtMs: undefined,
      now: 1000,
    })
    expect(result.prior).toBeUndefined()
    expect(result.transitioned).toBe(true)
    expect(result.view.stateEnteredAt).toBe(1000)
  })

  it("preserves stateEnteredAt when the state does not change", () => {
    const existing = {
      short: "ab12",
      state: "blocked" as const,
      harness: "claude" as const,
      stateEnteredAt: 500,
      updatedAtMs: undefined,
    }
    const result = applyStateEvent({
      existing,
      short: "ab12",
      state: "blocked",
      harness: "claude",
      updatedAtMs: undefined,
      now: 2000,
    })
    expect(result.transitioned).toBe(false)
    expect(result.view.stateEnteredAt).toBe(500)
  })

  it("resets stateEnteredAt on a real transition", () => {
    const existing = {
      short: "ab12",
      state: "working" as const,
      harness: "claude" as const,
      stateEnteredAt: 500,
      updatedAtMs: undefined,
    }
    const result = applyStateEvent({
      existing,
      short: "ab12",
      state: "blocked",
      harness: "claude",
      updatedAtMs: undefined,
      now: 2000,
    })
    expect(result.prior).toBe("working")
    expect(result.transitioned).toBe(true)
    expect(result.view.stateEnteredAt).toBe(2000)
  })
})

describe("computeStale / ageMs", () => {
  it("is stale only for an active state past the threshold", () => {
    expect(computeStale({ state: "blocked", updatedAtAgeMs: 999_999 })).toBe(true)
    expect(computeStale({ state: "blocked", updatedAtAgeMs: 1000 })).toBe(false)
    expect(computeStale({ state: "done", updatedAtAgeMs: 999_999 })).toBe(false)
    expect(computeStale({ state: "blocked", updatedAtAgeMs: undefined })).toBe(false)
  })

  it("ageMs resolves an already-parsed instant against now", () => {
    expect(ageMs({ now: 5000, atMs: 1000 })).toBe(4000)
    expect(ageMs({ now: 5000, atMs: undefined })).toBeUndefined()
    expect(ageMs({ now: 5000, atMs: Number.NaN })).toBeUndefined()
  })
})
