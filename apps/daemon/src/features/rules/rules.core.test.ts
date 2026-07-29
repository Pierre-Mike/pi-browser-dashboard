import { describe, expect, it } from "bun:test"
import { Either } from "effect"
import {
  ageMs,
  applyScreenEvent,
  applyStateEvent,
  CEILING_MAX_ACTIONS_PER_SESSION,
  CEILING_WINDOW_MS,
  computeStale,
  DEFAULT_COOLDOWN_MS,
  decodeSessionRemovedPayload,
  decodeSessionStatePayload,
  decodeTerminalStatePayload,
  evaluate,
  evaluateScreen,
  type FiringRecord,
  parseRulesFile,
  type Rule,
  type RulesFile,
  type ScreenSnapshot,
  type ScreenWhen,
  type SessionSnapshot,
  type SupervisorWhen,
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
          when: {
            source: "supervisor",
            state: "blocked",
            forMs: undefined,
            harness: undefined,
            stale: undefined,
          },
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
      when: {
        source: "supervisor",
        state: "blocked",
        forMs: 60_000,
        harness: "claude",
        stale: true,
      },
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

// --- screen triggers: parsing ---------------------------------------------------

describe("parseRulesFile — screen triggers", () => {
  it("parses a bare screen trigger, tagging the source and defaulting the rest", () => {
    const result = parseRulesFile({
      enabled: true,
      rules: [{ name: "s", when: { screen: "blocked" }, do: { action: "notify", message: "m" } }],
    })
    expect(Either.isRight(result)).toBe(true)
    if (Either.isLeft(result)) return
    expect(result.right.rules[0]?.when).toEqual({
      source: "screen",
      screen: "blocked",
      matcher: undefined,
      forMs: undefined,
    })
  })

  it("parses a matcher-scoped dwell trigger", () => {
    const result = parseRulesFile({
      enabled: true,
      rules: [
        {
          name: "s",
          when: { screen: "blocked", matcher: "workspace-trust-prompt", forMs: 30_000 },
          do: { action: "notify", message: "m" },
        },
      ],
    })
    expect(Either.isRight(result)).toBe(true)
    if (Either.isLeft(result)) return
    expect(result.right.rules[0]?.when).toEqual({
      source: "screen",
      screen: "blocked",
      matcher: "workspace-trust-prompt",
      forMs: 30_000,
    })
  })

  // A screen dwell on `working` is the one stuck-loop condition no supervisor
  // reading can express, so the screen vocabulary is deliberately NOT narrowed
  // the way the supervisor trigger list is.
  it("accepts every slug the classifier can actually report, working included", () => {
    for (const screen of ["working", "blocked", "idle", "unknown"]) {
      const result = parseRulesFile({
        enabled: true,
        rules: [{ name: "s", when: { screen }, do: { action: "stop" } }],
      })
      expect(Either.isRight(result)).toBe(true)
    }
  })

  it("rejects a screen slug the classifier can never report", () => {
    expect(
      messagesOf({ rules: [{ name: "s", when: { screen: "done" }, do: { action: "stop" } }] }),
    ).toEqual([expect.stringContaining("when.screen must be one of")])
  })

  it("rejects an unknown matcher name rather than accepting a rule that can never fire", () => {
    expect(
      messagesOf({
        rules: [
          {
            name: "s",
            when: { screen: "blocked", matcher: "permission_prompt" },
            do: { action: "stop" },
          },
        ],
      }),
    ).toEqual([expect.stringContaining("when.matcher must be one of")])
  })

  // `unknown` IS the absence of a matcher, so the two together describe a screen
  // that cannot exist — caught at parse time rather than as silence at 3am.
  it("rejects a matcher combined with screen: unknown", () => {
    expect(
      messagesOf({
        rules: [
          {
            name: "s",
            when: { screen: "unknown", matcher: "permission-prompt" },
            do: { action: "stop" },
          },
        ],
      }),
    ).toEqual([expect.stringContaining("when.matcher cannot be combined")])
  })

  it("rejects a when that sets both state and screen", () => {
    expect(
      messagesOf({
        rules: [
          { name: "s", when: { state: "blocked", screen: "blocked" }, do: { action: "stop" } },
        ],
      }),
    ).toEqual([expect.stringContaining("exactly one of")])
  })

  it("rejects a when that sets neither state nor screen", () => {
    expect(messagesOf({ rules: [{ name: "s", when: {}, do: { action: "stop" } }] })).toEqual([
      expect.stringContaining("exactly one of"),
    ])
  })

  // Silently ignoring a field is how an author ends up believing a rule is
  // narrower than it is.
  it("rejects the supervisor-only fields on a screen trigger", () => {
    expect(
      messagesOf({
        rules: [
          {
            name: "s",
            when: { screen: "blocked", harness: "pi", stale: true },
            do: { action: "stop" },
          },
        ],
      }),
    ).toEqual([
      expect.stringContaining("when.harness applies to a supervisor trigger"),
      expect.stringContaining("when.stale applies to a supervisor trigger"),
    ])
  })

  it("rejects a matcher on a supervisor trigger", () => {
    expect(
      messagesOf({
        rules: [
          {
            name: "s",
            when: { state: "blocked", matcher: "permission-prompt" },
            do: { action: "stop" },
          },
        ],
      }),
    ).toEqual([expect.stringContaining("when.matcher applies to a screen trigger")])
  })

  it("applies the same forMs range to a screen dwell", () => {
    expect(
      messagesOf({
        rules: [{ name: "s", when: { screen: "blocked", forMs: 0 }, do: { action: "stop" } }],
      }),
    ).toEqual([expect.stringContaining("when.forMs must be an integer")])
  })
})

// --- evaluate ------------------------------------------------------------------

// Builds the supervisor half of the `when` union with every optional field
// spelled out, so a rule under test differs from the default in exactly the
// field the test names.
const supervisorWhen = (
  overrides: Partial<Omit<SupervisorWhen, "source">> = {},
): SupervisorWhen => ({
  source: "supervisor",
  state: "blocked",
  forMs: undefined,
  harness: undefined,
  stale: undefined,
  ...overrides,
})

const screenWhen = (overrides: Partial<Omit<ScreenWhen, "source">> = {}): ScreenWhen => ({
  source: "screen",
  screen: "blocked",
  matcher: undefined,
  forMs: undefined,
  ...overrides,
})

const ruleOf = (overrides: Partial<Rule>): Rule => ({
  name: "r",
  enabled: true,
  when: supervisorWhen(),
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
    const rule = ruleOf({ when: supervisorWhen({ forMs: 60_000 }) })
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
      rules: fileOf([ruleOf({ when: supervisorWhen({ state: "done" }) })]),
      session: sessionOf({ state: "blocked" }),
      prior: "working",
      dwellMs: 0,
      now: 1000,
      history: [],
    })
    expect(outcomes).toEqual([])
  })

  it("filters on harness", () => {
    const rule = ruleOf({ when: supervisorWhen({ harness: "pi" }) })
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
    const rule = ruleOf({ when: supervisorWhen({ stale: true }) })
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

// --- screen triggers: evaluation --------------------------------------------------

const screenOf = (overrides: Partial<ScreenSnapshot> = {}): ScreenSnapshot => ({
  short: "ab12",
  state: "blocked",
  matcher: "permission-prompt",
  ...overrides,
})

const screenRule = (overrides: Partial<Rule> = {}): Rule =>
  ruleOf({ when: screenWhen(), ...overrides })

describe("evaluateScreen — matching", () => {
  it("fires on a transition into the target screen state", () => {
    expect(
      evaluateScreen({
        rules: fileOf([screenRule()]),
        screen: screenOf(),
        prior: "working",
        dwellMs: 0,
        now: 1000,
        history: [],
      }),
    ).toEqual([
      { _tag: "Fired", rule: "r", short: "ab12", action: { action: "notify", message: "hi" } },
    ])
  })

  it("does not re-fire a transition rule on an unchanged screen", () => {
    expect(
      evaluateScreen({
        rules: fileOf([screenRule()]),
        screen: screenOf(),
        prior: "blocked",
        dwellMs: 90_000,
        now: 1000,
        history: [],
      }),
    ).toEqual([])
  })

  // The condition that actually matters: a prompt answered in two seconds needs
  // no rule, one nobody has touched for two minutes does.
  it("a screen dwell waits out forMs, then fires", () => {
    const rule = screenRule({ when: screenWhen({ forMs: 120_000 }) })
    expect(
      evaluateScreen({
        rules: fileOf([rule]),
        screen: screenOf(),
        prior: "blocked",
        dwellMs: 119_999,
        now: 1000,
        history: [],
      }),
    ).toEqual([])
    expect(
      evaluateScreen({
        rules: fileOf([rule]),
        screen: screenOf(),
        prior: "blocked",
        dwellMs: 120_000,
        now: 1000,
        history: [],
      }),
    ).toHaveLength(1)
  })

  it("filters on the matcher — a permission-prompt rule is not a trust-prompt rule", () => {
    const rule = screenRule({ when: screenWhen({ matcher: "workspace-trust-prompt" }) })
    expect(
      evaluateScreen({
        rules: fileOf([rule]),
        screen: screenOf({ matcher: "permission-prompt" }),
        prior: "working",
        dwellMs: 0,
        now: 1000,
        history: [],
      }),
    ).toEqual([])
    expect(
      evaluateScreen({
        rules: fileOf([rule]),
        screen: screenOf({ matcher: "workspace-trust-prompt" }),
        prior: "working",
        dwellMs: 0,
        now: 1000,
        history: [],
      }),
    ).toHaveLength(1)
  })

  // A matcher-scoped rule acts on evidence. `unknown` carries none, so it must
  // not act — even though the pane may well still be blocked.
  it("never matches a matcher-scoped rule against an unclassified screen", () => {
    expect(
      evaluateScreen({
        rules: fileOf([screenRule({ when: screenWhen({ matcher: "permission-prompt" }) })]),
        screen: screenOf({ state: "unknown", matcher: undefined }),
        prior: "blocked",
        dwellMs: 0,
        now: 1000,
        history: [],
      }),
    ).toEqual([])
  })

  it("matches an unknown-screen rule when the classifier loses the thread", () => {
    expect(
      evaluateScreen({
        rules: fileOf([screenRule({ when: screenWhen({ screen: "unknown" }) })]),
        screen: screenOf({ state: "unknown", matcher: undefined }),
        prior: "blocked",
        dwellMs: 0,
        now: 1000,
        history: [],
      }),
    ).toHaveLength(1)
  })

  // The two evaluators read the same rules file; each must ignore the other's
  // rules rather than reading `when.state` off a screen observation or vice versa.
  it("ignores supervisor rules, and evaluate ignores screen rules", () => {
    const both = fileOf([
      ruleOf({ name: "sup" }),
      screenRule({ name: "scr", when: screenWhen({ screen: "idle" }) }),
    ])
    expect(
      evaluateScreen({
        rules: both,
        screen: screenOf({ state: "idle", matcher: "prompt-resting" }),
        prior: "working",
        dwellMs: 0,
        now: 1000,
        history: [],
      }).map((o) => o.rule),
    ).toEqual(["scr"])
    expect(
      evaluate({
        rules: both,
        session: sessionOf({}),
        prior: "working",
        dwellMs: 0,
        now: 1000,
        history: [],
      }).map((o) => o.rule),
    ).toEqual(["sup"])
  })
})

describe("evaluateScreen — safety suppressions", () => {
  it("refuses a keys action without the rule's own confirm", () => {
    expect(
      evaluateScreen({
        rules: fileOf([
          screenRule({ do: { action: "keys", sequence: ["enter"], confirm: false } }),
        ]),
        screen: screenOf(),
        prior: "working",
        dwellMs: 0,
        now: 1000,
        history: [],
      }),
    ).toEqual([
      {
        _tag: "Suppressed",
        rule: "r",
        short: "ab12",
        action: { action: "keys", sequence: ["enter"], confirm: false },
        reason: { _tag: "KeysNotConfirmed" },
      },
    ])
  })

  it("honours the per-rule cooldown", () => {
    const outcomes = evaluateScreen({
      rules: fileOf([screenRule({ cooldownMs: 10_000 })]),
      screen: screenOf(),
      prior: "working",
      dwellMs: 0,
      now: 1_000_000,
      history: [{ rule: "r", short: "ab12", at: 995_000 }],
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

  // The ceiling is per SESSION, not per source: the point is that nothing piles
  // onto one session, however many readings of it there are.
  it("counts supervisor firings against a screen rule's ceiling", () => {
    const history: readonly FiringRecord[] = Array.from(
      { length: CEILING_MAX_ACTIONS_PER_SESSION },
      (_, i) => ({ rule: `supervisor-${i}`, short: "ab12", at: 1000 - i }),
    )
    const outcomes = evaluateScreen({
      rules: fileOf([screenRule()]),
      screen: screenOf(),
      prior: "working",
      dwellMs: 0,
      now: 1000 + CEILING_WINDOW_MS / 2,
      history,
    })
    expect(outcomes).toHaveLength(1)
    expect(outcomes[0]).toMatchObject({ _tag: "Suppressed", reason: { _tag: "Ceiling" } })
  })

  it("suppresses a disabled screen rule but still reports the match", () => {
    const outcomes = evaluateScreen({
      rules: fileOf([screenRule({ enabled: false })]),
      screen: screenOf(),
      prior: "working",
      dwellMs: 0,
      now: 1000,
      history: [],
    })
    expect(outcomes[0]).toMatchObject({ _tag: "Suppressed", reason: { _tag: "Disabled" } })
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

describe("decodeTerminalStatePayload", () => {
  it("decodes a session-scoped classification", () => {
    expect(
      decodeTerminalStatePayload({
        scope: "session",
        id: "ab12",
        state: "blocked",
        matcher: "permission-prompt",
        evidence: "Do you want to proceed?",
        at: "2020-01-01T00:00:00.000Z",
      }),
    ).toEqual({ short: "ab12", state: "blocked", matcher: "permission-prompt" })
  })

  it("carries no matcher for an unclassified screen", () => {
    expect(
      decodeTerminalStatePayload({ scope: "session", id: "ab12", state: "unknown" })?.matcher,
    ).toBeUndefined()
  })

  // A rules file addresses sessions by short. The global, orchestrator and
  // project panes have no session behind them, so their `id` is not a short and
  // must never be treated as one.
  it("ignores every scope that is not a session", () => {
    for (const scope of ["global", "orchestrator", "project"]) {
      expect(decodeTerminalStatePayload({ scope, id: "x", state: "blocked" })).toBeUndefined()
    }
  })

  // Pane rows ride the same event as session rows, and a pane row's `id` is not
  // a short — a rule firing on one would send keystrokes to a session that does
  // not exist. Nothing is lost: the session-level row for the same short already
  // folds every pane into the worst reading.
  it("ignores a pane row, whose id is not an addressable short", () => {
    expect(
      decodeTerminalStatePayload({
        scope: "session",
        id: "ab12#terminal_1",
        state: "blocked",
        matcher: "permission-prompt",
      }),
    ).toBeUndefined()
  })

  it("rejects a malformed payload without throwing", () => {
    expect(decodeTerminalStatePayload(null)).toBeUndefined()
    expect(decodeTerminalStatePayload({ scope: "session", state: "blocked" })).toBeUndefined()
    expect(
      decodeTerminalStatePayload({ scope: "session", id: "ab12", state: "done" }),
    ).toBeUndefined()
  })

  // A matcher this build does not know is not a decode failure — the state is
  // still trustworthy, and a matcher-scoped rule simply will not match it.
  it("keeps an unrecognized matcher as an opaque string rather than failing", () => {
    expect(
      decodeTerminalStatePayload({
        scope: "session",
        id: "ab12",
        state: "blocked",
        matcher: "row-from-a-newer-build",
      })?.matcher,
    ).toBe("row-from-a-newer-build")
  })
})

describe("applyScreenEvent", () => {
  it("treats first sight of a pane as a transition", () => {
    const result = applyScreenEvent({
      existing: undefined,
      short: "ab12",
      state: "blocked",
      matcher: "permission-prompt",
      now: 1000,
    })
    expect(result.prior).toBeUndefined()
    expect(result.transitioned).toBe(true)
    expect(result.view.stateEnteredAt).toBe(1000)
  })

  it("preserves stateEnteredAt across a same-state observation", () => {
    const result = applyScreenEvent({
      existing: {
        short: "ab12",
        state: "blocked",
        matcher: "permission-prompt",
        stateEnteredAt: 500,
      },
      short: "ab12",
      state: "blocked",
      matcher: "permission-prompt",
      now: 2000,
    })
    expect(result.transitioned).toBe(false)
    expect(result.view.stateEnteredAt).toBe(500)
  })

  it("resets the dwell anchor on a real screen transition", () => {
    const result = applyScreenEvent({
      existing: {
        short: "ab12",
        state: "working",
        matcher: "thinking-gerund",
        stateEnteredAt: 500,
      },
      short: "ab12",
      state: "blocked",
      matcher: "permission-prompt",
      now: 2000,
    })
    expect(result.prior).toBe("working")
    expect(result.transitioned).toBe(true)
    expect(result.view.stateEnteredAt).toBe(2000)
  })

  // The matcher is the newest evidence either way — a same-state observation
  // that swapped one working spinner for another must still update it.
  it("always takes the latest matcher, transition or not", () => {
    const result = applyScreenEvent({
      existing: {
        short: "ab12",
        state: "working",
        matcher: "thinking-gerund",
        stateEnteredAt: 500,
      },
      short: "ab12",
      state: "working",
      matcher: "tool-call-waiting",
      now: 2000,
    })
    expect(result.transitioned).toBe(false)
    expect(result.view.matcher).toBe("tool-call-waiting")
    expect(result.view.stateEnteredAt).toBe(500)
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
