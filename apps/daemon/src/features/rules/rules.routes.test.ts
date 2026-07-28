import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { sseBus } from "../../platform/sse-bus"
import { createRulesEngine, type RulesPorts } from "./rules.io"
import { createApp } from "./rules.routes"

let root: string

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "rules-routes-"))
  await mkdir(join(root, "empty"), { recursive: true })

  await mkdir(join(root, "enabled", "pid-dashboard"), { recursive: true })
  await writeFile(
    join(root, "enabled", "pid-dashboard", "rules.json"),
    JSON.stringify({
      enabled: true,
      rules: [
        {
          name: "notify-on-blocked",
          when: { state: "blocked" },
          do: { action: "notify", message: "session is blocked" },
        },
      ],
    }),
  )

  await mkdir(join(root, "malformed", "pid-dashboard"), { recursive: true })
  await writeFile(join(root, "malformed", "pid-dashboard", "rules.json"), "{not json")

  // A dwell condition, not a transition — previewing takes a static snapshot
  // (no "just transitioned" instant to fabricate), so only a dwell rule can
  // show a Fired outcome in a preview; see rules.io.ts's own preview doc
  // comment.
  await mkdir(join(root, "dwell", "pid-dashboard"), { recursive: true })
  await writeFile(
    join(root, "dwell", "pid-dashboard", "rules.json"),
    JSON.stringify({
      enabled: true,
      rules: [
        {
          name: "still-stuck",
          when: { state: "blocked", forMs: 1000 },
          do: { action: "notify", message: "still stuck" },
        },
      ],
    }),
  )
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

// biome-ignore lint/suspicious/noExplicitAny: fake-port call capture is intentionally untyped for test brevity
type Call = any

const makePorts = (): {
  readonly ports: RulesPorts
  readonly notify: Call[]
  readonly sendKeys: Call[]
  readonly stop: Call[]
  readonly setClock: (ms: number) => void
} => {
  const notify: Call[] = []
  const sendKeys: Call[] = []
  const stop: Call[] = []
  let clock = Date.now()
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

const publishState = ({
  short,
  state,
}: {
  readonly short: string
  readonly state: string
}): void => {
  sseBus.publish({ type: "session.state", data: { short, state } })
}

describe("GET /rules — default-off shape", () => {
  it("reports enabled: false, paused: false, no errors, no rules with no rules.json present", async () => {
    const { ports } = makePorts()
    const engine = createRulesEngine({ ports, configDir: join(root, "empty") })
    engine.start()
    const app = createApp({ engine })
    const res = await app.request("/")
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      enabled: false,
      paused: false,
      errors: [],
      rules: [],
      log: [],
    })
  })

  it("surfaces a malformed rules.json as errors, not a 500", async () => {
    const { ports } = makePorts()
    const engine = createRulesEngine({ ports, configDir: join(root, "malformed") })
    engine.start()
    const app = createApp({ engine })
    const res = await app.request("/")
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.errors).toEqual([{ rule: "(file)", message: "rules.json is not valid JSON" }])
    expect(body.rules).toEqual([])
  })
})

describe("POST /rules/preview — fires nothing", () => {
  it("reports what would fire without calling any port", async () => {
    const { ports, notify, sendKeys, stop, setClock } = makePorts()
    const engine = createRulesEngine({ ports, configDir: join(root, "dwell") })
    engine.start()
    const app = createApp({ engine })
    const short = `preview-route-${crypto.randomUUID()}`
    setClock(5_000_000)
    publishState({ short, state: "blocked" })
    await sleep(50) // let the engine's own (unrelated to preview) bus handling settle

    setClock(5_002_000) // dwell well past forMs: 1000
    const res = await app.request("/preview", { method: "POST" })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(
      body.outcomes.some(
        (o: Call) => o._tag === "Fired" && o.rule === "still-stuck" && o.short === short,
      ),
    ).toBe(true)
    expect(notify).toEqual([])
    expect(sendKeys).toEqual([])
    expect(stop).toEqual([])
  })
})

describe("a real match calls exactly the expected port once", () => {
  it("fires notify exactly once on a real transition", async () => {
    const { ports, notify } = makePorts()
    const engine = createRulesEngine({ ports, configDir: join(root, "enabled") })
    engine.start()
    createApp({ engine }) // routes aren't exercised for this assertion — the engine itself is
    const short = `real-match-${crypto.randomUUID()}`
    publishState({ short, state: "working" })
    publishState({ short, state: "blocked" })
    await waitFor({ predicate: () => notify.some((n: Call) => n.short === short) })
    expect(notify.filter((n: Call) => n.short === short)).toHaveLength(1)
  })
})

describe("POST /rules/pause — suppresses everything", () => {
  it("stops the engine from firing once paused, and reports it via GET /rules", async () => {
    const { ports, notify } = makePorts()
    const engine = createRulesEngine({ ports, configDir: join(root, "enabled") })
    engine.start()
    const app = createApp({ engine })

    const pauseRes = await app.request("/pause", { method: "POST" })
    expect(pauseRes.status).toBe(200)
    expect(await pauseRes.json()).toEqual({ paused: true })

    const statusRes = await app.request("/")
    expect((await statusRes.json()).paused).toBe(true)

    const short = `paused-route-${crypto.randomUUID()}`
    publishState({ short, state: "working" })
    publishState({ short, state: "blocked" })
    await sleep(80)
    expect(notify.some((n: Call) => n.short === short)).toBe(false)

    const unpauseRes = await app.request("/pause", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paused: false }),
    })
    expect(await unpauseRes.json()).toEqual({ paused: false })
  })
})
