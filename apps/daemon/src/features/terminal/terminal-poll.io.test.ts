import { describe, expect, it } from "bun:test"
import type { PollCandidate } from "./terminal-poll.core"
import { createTerminalPoller, type TerminalPollPorts } from "./terminal-poll.io"

const SESSION_LIST = `default [Created 12h ago]
abcd1234 [Created 1m ago]
dead0000 [Created 3days ago] (EXITED - attach to resurrect)
`

const PANE_LIST = `PANE_ID  TYPE  TITLE
plugin_1  plugin  zellij:status-bar
terminal_0  terminal  bash -lc claude attach abcd1234; exec bash -l
`

type Published = {
  readonly scope: string
  readonly id: string
  readonly state: string
  readonly matcher: string | undefined
  readonly evidence: string | undefined
}

type Harness = {
  readonly ports: TerminalPollPorts
  readonly published: Published[]
  readonly dumped: string[]
  readonly paneListed: string[]
  readonly candidates: PollCandidate[]
  readonly attached: string[]
  readonly prior: Map<string, string>
  setNow: (ms: number) => void
  setDump: (text: string) => void
}

const makeHarness = (overrides?: Partial<TerminalPollPorts>): Harness => {
  const published: Published[] = []
  const dumped: string[] = []
  const paneListed: string[] = []
  const attached: string[] = []
  const prior = new Map<string, string>()
  const candidates: PollCandidate[] = [
    { scope: "global", id: "global", sessionName: "default" },
    { scope: "session", id: "abcd1234", sessionName: "abcd1234" },
  ]
  let nowMs = 1_000
  let dump = "Working..."

  const ports: TerminalPollPorts = {
    listCandidates: async () => candidates,
    listSessions: async () => SESSION_LIST,
    listPanes: async ({ sessionName }) => {
      paneListed.push(sessionName)
      return PANE_LIST
    },
    dumpScreen: async ({ sessionName, paneId }) => {
      dumped.push(`${sessionName}/${paneId}`)
      return dump
    },
    attachedSessionNames: () => [...attached],
    priorState: ({ key }) => prior.get(key) as never,
    publish: (record) => {
      published.push(record)
      prior.set(`${record.scope}:${record.id}`, record.state)
    },
    now: () => nowMs,
    ...overrides,
  }

  return {
    ports,
    published,
    dumped,
    paneListed,
    candidates,
    attached,
    prior,
    setNow: (ms) => {
      nowMs = ms
    },
    setDump: (text) => {
      dump = text
    },
  }
}

const makePoller = (h: Harness) => createTerminalPoller({ ports: h.ports, tailMaxChars: 8_000 })

describe("createTerminalPoller.tick", () => {
  it("dumps the first terminal pane of every owned, live, unattached session", async () => {
    const h = makeHarness()
    await makePoller(h).tick()
    expect(h.paneListed).toEqual(["default", "abcd1234"])
    // terminal_0, never the plugin panes, and never a bare dump-screen.
    expect(h.dumped).toEqual(["default/terminal_0", "abcd1234/terminal_0"])
  })

  it("publishes the classification against the same scope:id the WS tap uses", async () => {
    const h = makeHarness()
    await makePoller(h).tick()
    expect(h.published).toEqual([
      {
        scope: "global",
        id: "global",
        state: "working",
        matcher: "pi-working",
        evidence: "Working...",
      },
      {
        scope: "session",
        id: "abcd1234",
        state: "working",
        matcher: "pi-working",
        evidence: "Working...",
      },
    ])
  })

  it("skips a session with a live WS bridge — the bridge already classifies it", async () => {
    const h = makeHarness()
    h.attached.push("default")
    await makePoller(h).tick()
    expect(h.dumped).toEqual(["abcd1234/terminal_0"])
  })

  it("never spawns anything for a session that is not live", async () => {
    const h = makeHarness({ listSessions: async () => "" })
    await makePoller(h).tick()
    expect(h.paneListed).toEqual([])
    expect(h.dumped).toEqual([])
    expect(h.published).toEqual([])
  })

  it("publishes nothing when the state has not changed", async () => {
    const h = makeHarness()
    const poller = makePoller(h)
    await poller.tick()
    expect(h.published).toHaveLength(2)
    await poller.tick()
    // Same screen, same state — no second SSE event per terminal.
    expect(h.published).toHaveLength(2)
  })

  it("follows the screen when it changes", async () => {
    const h = makeHarness()
    const poller = makePoller(h)
    await poller.tick()
    // Question line plus option list: the rendered dialog shape, verbatim from
    // the live capture in terminal-state.core.test.ts. The bare question is not
    // enough any more — any screen can print a sentence.
    h.setDump(" Do you want to proceed?\n ❯ 1. Yes\n   2. No")
    await poller.tick()
    expect(h.published.slice(2).map((p) => p.state)).toEqual(["blocked", "blocked"])
  })

  it("publishes nothing for an empty dump rather than guessing", async () => {
    // A pane that has produced no output yet, or a session that died between
    // list-sessions and dump-screen: zellij prints nothing and exits 0.
    const h = makeHarness({ dumpScreen: async () => "" })
    await makePoller(h).tick()
    expect(h.published).toEqual([])
  })

  it("publishes nothing when a session has no terminal pane at all", async () => {
    const h = makeHarness({
      listPanes: async () => "PANE_ID  TYPE  TITLE\nplugin_1  plugin  zellij:status-bar\n",
    })
    await makePoller(h).tick()
    expect(h.dumped).toEqual([])
    expect(h.published).toEqual([])
  })

  it("one failing session does not stop the rest of the pass", async () => {
    const h = makeHarness({
      listPanes: async ({ sessionName }) => {
        if (sessionName === "default") throw new Error("session died mid-tick")
        return PANE_LIST
      },
    })
    await makePoller(h).tick()
    expect(h.published.map((p) => p.id)).toEqual(["abcd1234"])
  })

  it("coalesces overlapping passes into one", async () => {
    const h = makeHarness()
    const poller = makePoller(h)
    await Promise.all([poller.tick(), poller.tick(), poller.tick()])
    expect(h.dumped).toEqual(["default/terminal_0", "abcd1234/terminal_0"])
  })
})

describe("createTerminalPoller.start", () => {
  it("does nothing at all when the interval is 0 — the off switch", async () => {
    const h = makeHarness()
    const poller = makePoller(h)
    poller.start({ intervalMs: 0 })
    await Promise.resolve()
    expect(h.dumped).toEqual([])
    poller.stop()
  })

  it("runs one pass immediately so a fresh daemon has states before the first interval", async () => {
    const h = makeHarness()
    const poller = makePoller(h)
    poller.start({ intervalMs: 60_000 })
    await poller.tick()
    poller.stop()
    expect(h.published.length).toBeGreaterThan(0)
  })

  // PID_TERMINAL_POLL_MS reaches this through Number(), so a typo ("15s", "on")
  // arrives as NaN — which fails every `<= 0` guard while setInterval treats a
  // NaN delay as 0. Unchecked, one bad env var becomes an unbounded `zellij`
  // spawn loop against the user's live sessions. A non-finite interval must read
  // as "off", exactly like 0.
  it("treats a non-finite interval as off rather than as zero delay", async () => {
    const h = makeHarness()
    const poller = makePoller(h)
    poller.start({ intervalMs: Number.NaN })
    await Promise.resolve()
    await Promise.resolve()
    expect(h.dumped).toEqual([])
    // The refresh-on-read hook must not resurrect it either.
    h.setNow(9_999_999)
    poller.refreshIfStale()
    await Promise.resolve()
    expect(h.dumped).toEqual([])
    poller.stop()
  })
})

// This daemon has lost its entire timer subsystem on a long uptime before
// (sockets stayed alive, every setInterval stopped firing — see sessions.io's
// refresh-on-read). An interval alone is therefore not allowed to be the only
// thing keeping polled state fresh.
describe("createTerminalPoller.refreshIfStale", () => {
  it("polls on read when the last pass is older than the interval", async () => {
    const h = makeHarness()
    const poller = makePoller(h)
    poller.start({ intervalMs: 10_000 })
    await poller.tick()
    const passes = h.dumped.length

    h.setNow(1_000 + 30_000)
    poller.refreshIfStale()
    await poller.tick()
    expect(h.dumped.length).toBeGreaterThan(passes)
    poller.stop()
  })

  it("does not poll on read while the last pass is still fresh", async () => {
    const h = makeHarness()
    const poller = makePoller(h)
    poller.start({ intervalMs: 10_000 })
    await poller.tick()
    const passes = h.dumped.length

    h.setNow(1_000 + 500)
    poller.refreshIfStale()
    await Promise.resolve()
    expect(h.dumped.length).toBe(passes)
    poller.stop()
  })

  it("stays inert when the poller was never started — importing a module must not spawn zellij", async () => {
    const h = makeHarness()
    const poller = makePoller(h)
    poller.refreshIfStale()
    await Promise.resolve()
    await Promise.resolve()
    expect(h.dumped).toEqual([])
  })

  it("stays inert when polling is disabled, however stale the read looks", async () => {
    const h = makeHarness()
    const poller = makePoller(h)
    poller.start({ intervalMs: 0 })
    h.setNow(9_999_999)
    poller.refreshIfStale()
    await Promise.resolve()
    await Promise.resolve()
    expect(h.dumped).toEqual([])
  })
})
