import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { sseBus } from "../../platform/sse-bus"
import {
  createRulesEngine,
  RULES_REL_PATH,
  type RulesEngineApi,
  type RulesPorts,
  readRulesFile,
} from "./rules.io"

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "rules-io-"))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

const writeRulesFile = async (body: unknown): Promise<void> => {
  await mkdir(join(root, "pid-dashboard"), { recursive: true })
  await writeFile(join(root, RULES_REL_PATH), JSON.stringify(body))
}

// biome-ignore lint/suspicious/noExplicitAny: fake-port call capture is intentionally untyped for test brevity
type Call = any

const makeFakePorts = (): {
  readonly ports: RulesPorts
  readonly notify: Call[]
  readonly sendKeys: Call[]
  readonly stop: Call[]
  readonly setClock: (ms: number) => void
} => {
  const notify: Call[] = []
  const sendKeys: Call[] = []
  const stop: Call[] = []
  let clock = 1_000_000
  const ports: RulesPorts = {
    notify: async (input) => {
      notify.push(input)
    },
    sendKeys: async (input) => {
      sendKeys.push(input)
    },
    stop: async (input) => {
      stop.push(input)
    },
    now: () => clock,
  }
  return { ports, notify, sendKeys, stop, setClock: (ms) => (clock = ms) }
}

const publishState = ({
  short,
  state,
  harness,
}: {
  readonly short: string
  readonly state: string
  readonly harness?: string
}): void => {
  sseBus.publish({ type: "session.state", data: { short, state, ...(harness ? { harness } : {}) } })
}

const publishRemoved = (short: string): void => {
  sseBus.publish({ type: "session.removed", data: { short } })
}

// The exact record terminal.routes.ts's single writer `publishTerminalState`
// puts on the bus — `evidence` and `at` included, so these tests exercise the
// same payload shape the engine sees in production rather than a trimmed one.
const publishTerminalState = ({
  short,
  state,
  matcher,
  scope = "session",
}: {
  readonly short: string
  readonly state: string
  readonly matcher?: string
  readonly scope?: string
}): void => {
  sseBus.publish({
    type: "terminal.state",
    data: {
      scope,
      id: short,
      state,
      matcher,
      evidence: matcher === undefined ? undefined : "…matched line…",
      at: new Date().toISOString(),
    },
  })
}

// Shared by several tests below: start an engine against the current
// `root`, then drive a fresh session through working -> blocked (a
// transition, not a same-state no-op) so a `when.state: "blocked"` rule gets
// exactly one chance to match.
const startEngineAndTransitionToBlocked = ({
  ports,
  shortPrefix,
}: {
  readonly ports: RulesPorts
  readonly shortPrefix: string
}): { readonly engine: RulesEngineApi; readonly short: string } => {
  const engine = createRulesEngine({ ports, configDir: root })
  engine.start()
  const short = `${shortPrefix}-${crypto.randomUUID()}`
  publishState({ short, state: "working" })
  publishState({ short, state: "blocked" })
  return { engine, short }
}

// Every dwell test needs the same four things: fake ports, a started engine
// against the current `root`, the clock parked at a known instant, and a short
// nobody else in this file is using.
const startEngineWithClock = ({
  clock,
  shortPrefix,
}: {
  readonly clock: number
  readonly shortPrefix: string
}): ReturnType<typeof makeFakePorts> & {
  readonly engine: RulesEngineApi
  readonly short: string
} => {
  const fake = makeFakePorts()
  const engine = createRulesEngine({ ports: fake.ports, configDir: root })
  engine.start()
  fake.setClock(clock)
  return { ...fake, engine, short: `${shortPrefix}-${crypto.randomUUID()}` }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const waitFor = async ({
  predicate,
  timeoutMs = 1000,
}: {
  readonly predicate: () => boolean
  readonly timeoutMs?: number
}): Promise<void> => {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor: timed out")
    await sleep(5)
  }
}

describe("readRulesFile", () => {
  it("returns a disabled empty file when rules.json is absent", async () => {
    expect(await readRulesFile(root)).toEqual({
      rulesFile: { enabled: false, rules: [] },
      errors: [],
    })
  })

  it("returns a disabled empty file for a root that doesn't exist at all", async () => {
    expect(await readRulesFile(join(root, "does-not-exist"))).toEqual({
      rulesFile: { enabled: false, rules: [] },
      errors: [],
    })
  })

  it("parses a valid stored file", async () => {
    await writeRulesFile({
      enabled: true,
      rules: [{ name: "r", when: { state: "blocked" }, do: { action: "stop" } }],
    })
    const result = await readRulesFile(root)
    expect(result.errors).toEqual([])
    expect(result.rulesFile.enabled).toBe(true)
    expect(result.rulesFile.rules).toHaveLength(1)
  })

  it("surfaces malformed JSON as a file-level error rather than throwing", async () => {
    await mkdir(join(root, "pid-dashboard"), { recursive: true })
    await writeFile(join(root, RULES_REL_PATH), "{not json")
    expect(await readRulesFile(root)).toEqual({
      rulesFile: { enabled: false, rules: [] },
      errors: [{ rule: "(file)", message: "rules.json is not valid JSON" }],
    })
  })

  it("surfaces the validator's own errors for an invalid schema", async () => {
    await writeRulesFile({ rules: [{ when: { state: "blocked" } }] })
    const result = await readRulesFile(root)
    expect(result.rulesFile).toEqual({ enabled: false, rules: [] })
    expect(result.errors.length).toBeGreaterThan(0)
  })
})

describe("createRulesEngine — disabled by default", () => {
  it("fires nothing with no rules.json present", async () => {
    const { ports, notify } = makeFakePorts()
    const { engine } = startEngineAndTransitionToBlocked({ ports, shortPrefix: "no-file" })
    await sleep(80)
    expect(notify).toEqual([])
    const status = await engine.status()
    expect(status.enabled).toBe(false)
    expect(status.paused).toBe(false)
  })

  it("fires nothing when the file's top-level enabled is false, even with a matching enabled rule", async () => {
    await writeRulesFile({
      enabled: false,
      rules: [{ name: "r", when: { state: "blocked" }, do: { action: "notify", message: "m" } }],
    })
    const { ports, notify } = makeFakePorts()
    startEngineAndTransitionToBlocked({ ports, shortPrefix: "disabled-file" })
    await sleep(80)
    expect(notify).toEqual([])
  })
})

describe("createRulesEngine — bus-triggered transitions", () => {
  it("fires a notify action on a transition into the target state", async () => {
    await writeRulesFile({
      enabled: true,
      rules: [{ name: "r", when: { state: "blocked" }, do: { action: "notify", message: "m" } }],
    })
    const { ports, notify } = makeFakePorts()
    const engine = createRulesEngine({ ports, configDir: root })
    engine.start()
    const short = `transition-${crypto.randomUUID()}`
    publishState({ short, state: "working" })
    publishState({ short, state: "blocked" })
    await waitFor({ predicate: () => notify.length === 1 })
    expect(notify[0]).toEqual({ short, rule: "r", message: "m" })
    const status = await engine.status()
    expect(status.log.some((e) => e._tag === "Fired" && e.short === short)).toBe(true)
  })

  it("does not re-fire on a same-state re-publish (no transition)", async () => {
    await writeRulesFile({
      enabled: true,
      rules: [{ name: "r", when: { state: "blocked" }, do: { action: "notify", message: "m" } }],
    })
    const { ports, notify } = makeFakePorts()
    createRulesEngine({ ports, configDir: root }).start()
    const short = `same-state-${crypto.randomUUID()}`
    publishState({ short, state: "blocked" })
    await waitFor({ predicate: () => notify.length === 1 })
    publishState({ short, state: "blocked" })
    await sleep(80)
    expect(notify).toHaveLength(1)
  })

  it("respects the per-rule cooldown, then fires again once it elapses", async () => {
    await writeRulesFile({
      enabled: true,
      rules: [
        {
          name: "r",
          when: { state: "blocked" },
          do: { action: "notify", message: "m" },
          cooldownMs: 60_000,
        },
      ],
    })
    const { ports, notify, setClock } = makeFakePorts()
    createRulesEngine({ ports, configDir: root }).start()
    const short = `cooldown-${crypto.randomUUID()}`
    setClock(1_000_000)
    publishState({ short, state: "working" })
    publishState({ short, state: "blocked" })
    await waitFor({ predicate: () => notify.length === 1 })

    // Re-transition inside the cooldown window: suppressed, not fired.
    publishState({ short, state: "working" })
    publishState({ short, state: "blocked" })
    await sleep(80)
    expect(notify).toHaveLength(1)

    // Advance the clock past cooldownMs, then transition again: fires.
    setClock(1_000_000 + 60_001)
    publishState({ short, state: "working" })
    publishState({ short, state: "blocked" })
    await waitFor({ predicate: () => notify.length === 2 })
  })

  it("clears its per-session view on session.removed — a re-appearance is treated as first sight", async () => {
    // cooldownMs: 0 isolates this test to the view-clearing behavior itself
    // — the cooldown loop breaker has its own dedicated test above.
    await writeRulesFile({
      enabled: true,
      rules: [
        {
          name: "r",
          when: { state: "blocked" },
          do: { action: "notify", message: "m" },
          cooldownMs: 0,
        },
      ],
    })
    const { ports, notify } = makeFakePorts()
    createRulesEngine({ ports, configDir: root }).start()
    const short = `removed-${crypto.randomUUID()}`
    publishState({ short, state: "blocked" })
    await waitFor({ predicate: () => notify.length === 1 })
    publishRemoved(short)
    // Without an intervening non-blocked state, a fresh "blocked" now counts
    // as first sight again (prior undefined) rather than a same-state no-op.
    publishState({ short, state: "blocked" })
    await waitFor({ predicate: () => notify.length === 2 })
  })

  it("never sends keys without the rule's own confirm: true", async () => {
    await writeRulesFile({
      enabled: true,
      rules: [
        {
          name: "r",
          when: { state: "blocked" },
          do: { action: "keys", sequence: ["enter"] },
        },
      ],
    })
    const { ports, sendKeys } = makeFakePorts()
    const { engine, short } = startEngineAndTransitionToBlocked({
      ports,
      shortPrefix: "unconfirmed-keys",
    })
    await sleep(80)
    expect(sendKeys).toEqual([])
    const status = await engine.status()
    expect(
      status.log.some(
        (e) => e._tag === "Suppressed" && e.short === short && e.reason._tag === "KeysNotConfirmed",
      ),
    ).toBe(true)
  })
})

describe("createRulesEngine — pause", () => {
  it("suppresses every action while paused, without erroring", async () => {
    await writeRulesFile({
      enabled: true,
      rules: [{ name: "r", when: { state: "blocked" }, do: { action: "notify", message: "m" } }],
    })
    const { ports, notify } = makeFakePorts()
    const engine = createRulesEngine({ ports, configDir: root })
    engine.start()
    await engine.pause(true)
    const short = `paused-${crypto.randomUUID()}`
    publishState({ short, state: "working" })
    publishState({ short, state: "blocked" })
    await sleep(80)
    expect(notify).toEqual([])
    const status = await engine.status()
    expect(status.paused).toBe(true)
    await engine.pause(false)
    expect((await engine.status()).paused).toBe(false)
  })
})

describe("createRulesEngine — dwell via tick", () => {
  it("does not fire before forMs has elapsed, then does on a later tick", async () => {
    await writeRulesFile({
      enabled: true,
      rules: [
        {
          name: "r",
          when: { state: "blocked", forMs: 1000 },
          do: { action: "notify", message: "still stuck" },
        },
      ],
    })
    const { notify, setClock, engine, short } = startEngineWithClock({
      clock: 2_000_000,
      shortPrefix: "dwell",
    })
    publishState({ short, state: "working" })
    publishState({ short, state: "blocked" })
    await sleep(30) // let the transition's own (non-firing) bus handling settle

    setClock(2_000_500) // 500ms dwell — not yet ripe
    await engine.tick()
    expect(notify).toEqual([])

    setClock(2_001_100) // 1100ms dwell — ripe
    await engine.tick()
    expect(notify).toHaveLength(1)
    expect(notify[0]).toEqual({ short, rule: "r", message: "still stuck" })
  })
})

describe("createRulesEngine — screen-triggered rules", () => {
  it("fires on a terminal.state transition, off the same bus as session.state", async () => {
    await writeRulesFile({
      enabled: true,
      rules: [
        { name: "s", when: { screen: "blocked" }, do: { action: "notify", message: "pane stuck" } },
      ],
    })
    const { ports, notify } = makeFakePorts()
    createRulesEngine({ ports, configDir: root }).start()
    const short = `screen-${crypto.randomUUID()}`
    publishTerminalState({ short, state: "working", matcher: "thinking-gerund" })
    publishTerminalState({ short, state: "blocked", matcher: "permission-prompt" })
    await waitFor({ predicate: () => notify.length === 1 })
    expect(notify[0]).toEqual({ short, rule: "s", message: "pane stuck" })
  })

  // The capability the task exists for, and the reason it is not a default rule:
  // answering a permission prompt is a per-rule decision for the human who owns
  // the machine. Here an explicit, confirmed rule does it.
  it("answers a named dialog with keys when the rule confirms it", async () => {
    await writeRulesFile({
      enabled: true,
      rules: [
        {
          name: "trust-the-folder",
          when: { screen: "blocked", matcher: "workspace-trust-prompt" },
          do: { action: "keys", sequence: ["enter"], confirm: true },
        },
      ],
    })
    const { ports, sendKeys } = makeFakePorts()
    createRulesEngine({ ports, configDir: root }).start()
    const short = `trust-${crypto.randomUUID()}`
    publishTerminalState({ short, state: "blocked", matcher: "workspace-trust-prompt" })
    await waitFor({ predicate: () => sendKeys.length === 1 })
    expect(sendKeys[0]).toEqual({ short, sequence: ["enter"] })
  })

  it("does not fire a matcher-scoped rule for a different dialog in the same state", async () => {
    await writeRulesFile({
      enabled: true,
      rules: [
        {
          name: "trust-only",
          when: { screen: "blocked", matcher: "workspace-trust-prompt" },
          do: { action: "notify", message: "m" },
        },
      ],
    })
    const { ports, notify } = makeFakePorts()
    createRulesEngine({ ports, configDir: root }).start()
    const short = `wrong-matcher-${crypto.randomUUID()}`
    publishTerminalState({ short, state: "blocked", matcher: "permission-prompt" })
    await sleep(80)
    expect(notify).toEqual([])
  })

  // A global/orchestrator/project pane's `id` is not a session short, so it must
  // never be addressed as one.
  it("ignores a classification for a pane that is not a session", async () => {
    await writeRulesFile({
      enabled: true,
      rules: [{ name: "s", when: { screen: "blocked" }, do: { action: "notify", message: "m" } }],
    })
    const { ports, notify } = makeFakePorts()
    createRulesEngine({ ports, configDir: root }).start()
    publishTerminalState({ short: "global", state: "blocked", scope: "global" })
    await sleep(80)
    expect(notify).toEqual([])
  })

  it("holds a screen dwell until forMs has elapsed, then fires on a tick", async () => {
    await writeRulesFile({
      enabled: true,
      rules: [
        {
          name: "s",
          when: { screen: "blocked", forMs: 1000 },
          do: { action: "notify", message: "unanswered for a while" },
        },
      ],
    })
    const { notify, setClock, engine, short } = startEngineWithClock({
      clock: 4_000_000,
      shortPrefix: "screen-dwell",
    })
    publishTerminalState({ short, state: "blocked", matcher: "permission-prompt" })
    await sleep(30)

    setClock(4_000_500)
    await engine.tick()
    expect(notify).toEqual([])

    setClock(4_001_100)
    await engine.tick()
    expect(notify).toHaveLength(1)
    expect(notify[0]).toEqual({ short, rule: "s", message: "unanswered for a while" })
  })

  it("drops the screen view on session.removed", async () => {
    await writeRulesFile({
      enabled: true,
      rules: [
        {
          name: "s",
          when: { screen: "blocked", forMs: 1000 },
          do: { action: "notify", message: "m" },
          cooldownMs: 0,
        },
      ],
    })
    const { ports, notify, setClock } = makeFakePorts()
    const engine = createRulesEngine({ ports, configDir: root })
    engine.start()
    const short = `screen-removed-${crypto.randomUUID()}`
    setClock(5_000_000)
    publishTerminalState({ short, state: "blocked", matcher: "permission-prompt" })
    await sleep(30)
    publishRemoved(short)
    // The dwell would be ripe if the view had survived; with it gone there is
    // nothing left to sweep.
    setClock(5_002_000)
    await engine.tick()
    expect(notify).toEqual([])
  })

  it("suppresses screen rules while paused", async () => {
    await writeRulesFile({
      enabled: true,
      rules: [{ name: "s", when: { screen: "blocked" }, do: { action: "notify", message: "m" } }],
    })
    const { ports, notify } = makeFakePorts()
    const engine = createRulesEngine({ ports, configDir: root })
    engine.start()
    await engine.pause(true)
    publishTerminalState({
      short: `screen-paused-${crypto.randomUUID()}`,
      state: "blocked",
      matcher: "permission-prompt",
    })
    await sleep(80)
    expect(notify).toEqual([])
  })

  // The ceiling is per session, not per reading — five supervisor firings spend
  // the budget a screen rule would otherwise have.
  it("counts supervisor firings against a screen rule's per-session ceiling", async () => {
    await writeRulesFile({
      enabled: true,
      rules: [
        {
          name: "sup",
          when: { state: "blocked" },
          do: { action: "notify", message: "sup" },
          cooldownMs: 0,
        },
        {
          name: "scr",
          when: { screen: "blocked" },
          do: { action: "notify", message: "scr" },
          cooldownMs: 0,
        },
      ],
    })
    const { ports, notify } = makeFakePorts()
    const engine = createRulesEngine({ ports, configDir: root })
    engine.start()
    const short = `ceiling-${crypto.randomUUID()}`
    // Five supervisor transitions into blocked, each firing once.
    for (let i = 0; i < 5; i++) {
      publishState({ short, state: "working" })
      publishState({ short, state: "blocked" })
      // Sequential on purpose: each firing must land before the next transition,
      // or the ceiling would be reached by a race rather than by five firings.
      await waitFor({ predicate: () => notify.length === i + 1 })
    }
    expect(notify).toHaveLength(5)
    publishTerminalState({ short, state: "blocked", matcher: "permission-prompt" })
    await sleep(80)
    expect(notify).toHaveLength(5)
    const status = await engine.status()
    expect(
      status.log.some(
        (e) => e._tag === "Suppressed" && e.rule === "scr" && e.reason._tag === "Ceiling",
      ),
    ).toBe(true)
  })
})

describe("createRulesEngine — preview", () => {
  it("reports what would fire without touching any port", async () => {
    await writeRulesFile({
      enabled: true,
      rules: [
        {
          name: "r",
          when: { state: "blocked", forMs: 1000 },
          do: { action: "notify", message: "m" },
        },
      ],
    })
    const { ports, notify, sendKeys, stop, setClock } = makeFakePorts()
    const engine = createRulesEngine({ ports, configDir: root })
    engine.start()
    const short = `preview-${crypto.randomUUID()}`
    setClock(3_000_000)
    publishState({ short, state: "blocked" })
    await sleep(30)

    setClock(3_002_000) // dwell well past forMs
    const preview = await engine.preview()
    expect(preview.errors).toEqual([])
    expect(
      preview.outcomes.some((o) => o._tag === "Fired" && o.rule === "r" && o.short === short),
    ).toBe(true)
    expect(notify).toEqual([])
    expect(sendKeys).toEqual([])
    expect(stop).toEqual([])
  })

  // The dry run is what an author checks before ever setting `enabled: true`, so
  // a screen rule missing from it would be invisible exactly when it matters.
  it("includes screen-triggered rules in the dry run", async () => {
    await writeRulesFile({
      enabled: true,
      rules: [
        {
          name: "s",
          when: { screen: "blocked", matcher: "permission-prompt", forMs: 1000 },
          do: { action: "notify", message: "m" },
        },
      ],
    })
    const { notify, setClock, engine, short } = startEngineWithClock({
      clock: 6_000_000,
      shortPrefix: "screen-preview",
    })
    publishTerminalState({ short, state: "blocked", matcher: "permission-prompt" })
    await sleep(30)

    setClock(6_002_000)
    const preview = await engine.preview()
    expect(
      preview.outcomes.some((o) => o._tag === "Fired" && o.rule === "s" && o.short === short),
    ).toBe(true)
    expect(notify).toEqual([])
  })

  it("surfaces validation errors instead of previewing against a broken file", async () => {
    await writeRulesFile({ rules: [{ when: { state: "blocked" } }] })
    const { ports } = makeFakePorts()
    const engine = createRulesEngine({ ports, configDir: root })
    engine.start()
    const preview = await engine.preview()
    expect(preview.outcomes).toEqual([])
    expect(preview.errors.length).toBeGreaterThan(0)
  })
})
