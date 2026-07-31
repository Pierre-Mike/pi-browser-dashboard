import { describe, expect, it } from "bun:test"
import {
  MAX_PANES_PER_SESSION,
  MAX_READS_PER_PASS,
  MAX_READS_PER_PASS_WATCHED,
  PANE_LIST_REFRESH_PASSES,
  type PollCandidate,
} from "./terminal-poll.core"
import { createTerminalPoller, type ScreenText, type TerminalPollPorts } from "./terminal-poll.io"

const SESSION_LIST = `default [Created 12h ago]
abcd1234 [Created 1m ago]
dead0000 [Created 3days ago] (EXITED - attach to resurrect)
`

const PANE_LIST = `PANE_ID  TYPE  TITLE
plugin_1  plugin  zellij:status-bar
terminal_0  terminal  bash -lc claude attach abcd1234; exec bash -l
`

// Verbatim `action list-panes` for a session with a second pane opened next to
// the layout's content pane (captured against a session created for the purpose,
// zellij 0.44.3).
const TWO_PANE_LIST = `PANE_ID  TYPE  TITLE
terminal_0  terminal  pierre-mikel@mac-1:~/Github/pi-browser-dashboard
terminal_1  terminal  probe
`

type Published = {
  readonly scope: string
  readonly id: string
  readonly state: string
  readonly matcher: string | undefined
  readonly evidence: string | undefined
  readonly paneId: string | undefined
}

type Forgotten = {
  readonly scope: string
  readonly id: string
  readonly keepPaneIds: ReadonlyArray<string>
}

type Read = { readonly scope: string; readonly id: string }

type Harness = {
  readonly ports: TerminalPollPorts
  readonly published: Published[]
  readonly reads: Read[]
  readonly noted: ScreenText[]
  readonly dumped: string[]
  readonly paneListed: string[]
  readonly forgotten: Forgotten[]
  readonly candidates: PollCandidate[]
  readonly attached: string[]
  readonly prior: Map<string, string>
  setNow: (ms: number) => void
  setDump: (text: string) => void
  setPaneDump: (input: { readonly paneId: string; readonly text: string }) => void
}

const makeHarness = (overrides?: Partial<TerminalPollPorts>): Harness => {
  const published: Published[] = []
  const reads: Read[] = []
  const noted: ScreenText[] = []
  const dumped: string[] = []
  const paneListed: string[] = []
  const forgotten: Forgotten[] = []
  const attached: string[] = []
  const prior = new Map<string, string>()
  const candidates: PollCandidate[] = [
    { scope: "global", id: "global", sessionName: "default" },
    { scope: "session", id: "abcd1234", sessionName: "abcd1234" },
  ]
  let nowMs = 1_000
  // pi's rendered spinner line: the bare literal no longer classifies.
  let dump = " ⠋ Working..."
  const perPane = new Map<string, string>()

  const ports: TerminalPollPorts = {
    listCandidates: async () => candidates,
    listSessions: async () => SESSION_LIST,
    listPanes: async ({ sessionName }) => {
      paneListed.push(sessionName)
      return PANE_LIST
    },
    dumpScreen: async ({ sessionName, paneId }) => {
      dumped.push(`${sessionName}/${paneId}`)
      return perPane.get(paneId) ?? dump
    },
    attachedSessionNames: () => [...attached],
    priorState: ({ key }) => prior.get(key) as never,
    publish: (record) => {
      published.push(record)
      prior.set(`${record.scope}:${record.id}`, record.state)
    },
    noteScreen: (screen) => {
      noted.push(screen)
    },
    noteRead: (input) => {
      reads.push({ scope: input.scope, id: input.id })
    },
    forgetPaneStates: (input) => {
      forgotten.push({ scope: input.scope, id: input.id, keepPaneIds: [...input.keepPaneIds] })
    },
    hasScreenWaiters: () => false,
    now: () => nowMs,
    ...overrides,
  }

  return {
    ports,
    published,
    reads,
    noted,
    dumped,
    paneListed,
    forgotten,
    candidates,
    attached,
    prior,
    setNow: (ms) => {
      nowMs = ms
    },
    setDump: (text) => {
      dump = text
    },
    setPaneDump: ({ paneId, text }) => {
      perPane.set(paneId, text)
    },
  }
}

const makePoller = (h: Harness) => createTerminalPoller({ ports: h.ports, tailMaxChars: 8_000 })

// One published row by its id, or a failed test naming the row that is missing —
// so an assertion reads `row.state` rather than `row?.state`, and a row that was
// never published fails loudly instead of comparing undefined to undefined.
const rowFor = (input: { readonly h: Harness; readonly id: string }): Published => {
  const row = input.h.published.find((p) => p.id === input.id)
  if (row === undefined) throw new Error(`no row published for id ${input.id}`)
  return row
}

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
        evidence: "⠋ Working...",
        // Provenance: which pane that reading came off. A single-pane session
        // gets no separate pane row, so this is the only place it is recorded.
        paneId: "terminal_0",
      },
      {
        scope: "session",
        id: "abcd1234",
        state: "working",
        matcher: "pi-working",
        evidence: "⠋ Working...",
        paneId: "terminal_0",
      },
    ])
  })

  it("publishes no pane row for a single-pane session — it would only duplicate", async () => {
    const h = makeHarness()
    await makePoller(h).tick()
    expect(h.published.map((p) => p.id)).toEqual(["global", "abcd1234"])
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

  // `wait --until-output` resolves off these observations and nothing else, so
  // the gate that stops redundant SSE events must NOT also gate them: a pattern
  // routinely appears while the classification is unchanged.
  it("offers every dump's text to screen observers, transition or not", async () => {
    const h = makeHarness()
    const poller = makePoller(h)
    await poller.tick()
    expect(h.noted).toHaveLength(2)
    await poller.tick()
    // Second pass: same screen, so nothing published — but still noted.
    expect(h.published).toHaveLength(2)
    expect(h.noted).toHaveLength(4)
  })

  // The freshness half of the same split. `publish` is gated on a state change
  // and must stay that way (an SSE event per pass, per row, to every browser
  // carries no information); the READ itself happened on every pass, and a reader
  // that cannot see that reported a two-hour-old reading off a pane dumped
  // seconds earlier.
  it("records a read for the session row on every pass, changed or not", async () => {
    const h = makeHarness()
    const poller = makePoller(h)
    await poller.tick()
    expect(h.reads).toEqual([
      { scope: "global", id: "global" },
      { scope: "session", id: "abcd1234" },
    ])
    await poller.tick()
    // Same screen: nothing new published, but both panes were read again.
    expect(h.published).toHaveLength(2)
    expect(h.reads).toHaveLength(4)
  })

  it("records no read for an empty dump — nothing was actually read", async () => {
    const h = makeHarness({ dumpScreen: async () => "" })
    await makePoller(h).tick()
    expect(h.reads).toEqual([])
  })

  it("records no read for a session whose pane list could not be read", async () => {
    const h = makeHarness({
      listPanes: async () => {
        throw new Error("session died mid-tick")
      },
    })
    await makePoller(h).tick()
    expect(h.reads).toEqual([])
  })

  it("notes the ANSI-stripped text against the same scope and id it publishes", async () => {
    const h = makeHarness()
    h.setDump("[38;2;220;129;97mElucidating…[0m")
    await makePoller(h).tick()
    const session = h.noted.find((n) => n.scope === "session")
    expect(session?.id).toBe("abcd1234")
    expect(session?.text).toBe("Elucidating…")
  })

  it("notes nothing for an empty dump — there is no screen to match against", async () => {
    const h = makeHarness({ dumpScreen: async () => "" })
    await makePoller(h).tick()
    expect(h.noted).toEqual([])
  })

  // An observer is a wait fiber's callback. One that throws must not cost the
  // pass its remaining targets or its state publishing.
  it("survives an observer that throws, and still publishes", async () => {
    const h = makeHarness({
      noteScreen: () => {
        throw new Error("observer exploded")
      },
    })
    await makePoller(h).tick()
    expect(h.published).toHaveLength(2)
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

// Every pane, not just the first. An agent running in a session's second pane
// used to be invisible to chips, `wait --via screen`, `explain`, `pid terminals`
// and rules all at once.
describe("createTerminalPoller.tick over several panes", () => {
  const twoPaneHarness = (overrides?: Partial<TerminalPollPorts>): Harness =>
    makeHarness({ listPanes: async () => TWO_PANE_LIST, ...overrides })

  // A dialog waiting for an answer in pane 1 while pane 0 generates. Written as
  // the rendered SHAPE (question line + option list) because a bare question is
  // a sentence any screen can print; the literal renders live only in
  // terminal-state.core.test.ts's fixtures.
  const BLOCKED_DUMP = " Do you want to proceed?\n ❯ 1. Yes\n   2. No"

  it("dumps every terminal pane of the session, in pane order", async () => {
    const h = twoPaneHarness()
    await makePoller(h).tick()
    expect(h.dumped).toEqual([
      "default/terminal_0",
      "default/terminal_1",
      "abcd1234/terminal_0",
      "abcd1234/terminal_1",
    ])
  })

  it("gives each pane its own row beside the session's, keyed <id>#<paneId>", async () => {
    const h = twoPaneHarness()
    await makePoller(h).tick()
    const session = h.published.filter((p) => p.scope === "session")
    expect(session.map((p) => p.id)).toEqual([
      "abcd1234#terminal_0",
      "abcd1234#terminal_1",
      "abcd1234",
    ])
  })

  // The decision this feature turns on: one blocked pane, one working pane. A
  // session-level `working` would hide a prompt nothing else will ever answer,
  // so the row reports the blocked pane — and names it, so the working pane is
  // still there to be read on its own row.
  it("reports the blocked pane at session level when panes disagree", async () => {
    const h = twoPaneHarness()
    h.setPaneDump({ paneId: "terminal_1", text: BLOCKED_DUMP })
    await makePoller(h).tick()
    const row = rowFor({ h, id: "abcd1234" })
    expect(row.state).toBe("blocked")
    expect(row.paneId).toBe("terminal_1")
    // Not a synthesized summary: the matcher and the matched line are the
    // blocked pane's own, carried through verbatim.
    expect(row.matcher).toBe("permission-prompt")
    expect(row.evidence).toBe(rowFor({ h, id: "abcd1234#terminal_1" }).evidence)
  })

  it("hides neither pane while reporting the more urgent one", async () => {
    const h = twoPaneHarness()
    h.setPaneDump({ paneId: "terminal_1", text: BLOCKED_DUMP })
    await makePoller(h).tick()
    expect(rowFor({ h, id: "abcd1234#terminal_0" }).state).toBe("working")
    expect(rowFor({ h, id: "abcd1234#terminal_1" }).state).toBe("blocked")
  })

  it("keeps each pane's own transition gate, so one pane changing publishes one pane row", async () => {
    const h = twoPaneHarness()
    const poller = makePoller(h)
    await poller.tick()
    const before = h.published.length
    h.setPaneDump({ paneId: "terminal_1", text: BLOCKED_DUMP })
    await poller.tick()
    // pane 1's row (working -> blocked) and both session rows (working ->
    // blocked); pane 0 is unchanged and stays silent.
    expect(h.published.slice(before).map((p) => p.id)).toEqual([
      "global#terminal_1",
      "global",
      "abcd1234#terminal_1",
      "abcd1234",
    ])
  })

  // `wait --until-output` matches against the session's short, so a pattern that
  // appears in pane 1 has to reach it under the session id — otherwise the wait
  // only ever sees pane 0 and times out on text that is plainly on screen.
  it("notes every pane's screen under the session id, tagged with the pane", async () => {
    const h = twoPaneHarness()
    h.setPaneDump({ paneId: "terminal_1", text: "pane two says 42 passed" })
    await makePoller(h).tick()
    const session = h.noted.filter((n) => n.scope === "session" && n.id === "abcd1234")
    expect(session.map((n) => n.paneId)).toEqual(["terminal_0", "terminal_1"])
    expect(session[1]?.text).toContain("42 passed")
  })

  // Every row that has its own entry in the map needs its own freshness stamp,
  // pane rows included — `pid terminals` prints one line per row and each line
  // has to answer "how old is this reading" for itself.
  it("records a read for each pane row and for the session row", async () => {
    const h = twoPaneHarness()
    await makePoller(h).tick()
    expect(h.reads.filter((r) => r.scope === "session")).toEqual([
      { scope: "session", id: "abcd1234#terminal_0" },
      { scope: "session", id: "abcd1234#terminal_1" },
      { scope: "session", id: "abcd1234" },
    ])
  })

  // A pane the user closed must not leave a row behind: a stale `blocked` row is
  // exactly the misinformation this feature exists to remove.
  it("asks for the pane rows of closed panes to be forgotten, keeping the live ones", async () => {
    const h = twoPaneHarness()
    await makePoller(h).tick()
    expect(h.forgotten).toEqual([
      { scope: "global", id: "global", keepPaneIds: ["terminal_0", "terminal_1"] },
      { scope: "session", id: "abcd1234", keepPaneIds: ["terminal_0", "terminal_1"] },
    ])
  })

  it("forgets every pane row once a session is back to a single pane", async () => {
    const h = makeHarness()
    await makePoller(h).tick()
    expect(h.forgotten).toEqual([
      { scope: "global", id: "global", keepPaneIds: [] },
      { scope: "session", id: "abcd1234", keepPaneIds: [] },
    ])
  })

  it("forgets nothing when the pane list could not be read — a hiccup is not a closure", async () => {
    const h = makeHarness({
      listPanes: async () => {
        throw new Error("session died mid-tick")
      },
    })
    await makePoller(h).tick()
    expect(h.forgotten).toEqual([])
  })

  it("folds only the panes it could actually read", async () => {
    const h = twoPaneHarness({
      dumpScreen: async ({ sessionName, paneId }) =>
        paneId === "terminal_1" ? "" : `${sessionName} ⠋ Working...`,
    })
    await makePoller(h).tick()
    // An unreadable pane contributes nothing rather than voiding the pass: the
    // readable pane still gets a row, and so does the session.
    expect(h.published.filter((p) => p.scope === "session").map((p) => p.id)).toEqual([
      "abcd1234#terminal_0",
      "abcd1234",
    ])
  })

  it("caps one session's panes so a pane wall cannot consume the pass", async () => {
    const wall = ["PANE_ID  TYPE  TITLE"]
    for (let i = 0; i < 12; i++) wall.push(`terminal_${i}  terminal  bash`)
    const h = makeHarness({ listPanes: async () => `${wall.join("\n")}\n` })
    await makePoller(h).tick()
    const perSession = h.dumped.filter((d) => d.startsWith("abcd1234/"))
    expect(perSession).toHaveLength(MAX_PANES_PER_SESSION)
    expect(perSession[0]).toBe("abcd1234/terminal_0")
  })
})

// Enough candidates that the per-pass read budget bites with one pane each.
const manyCandidates = (count: number): PollCandidate[] =>
  Array.from({ length: count }, (_, i) => ({
    scope: "session" as const,
    id: `s${i}`,
    sessionName: `s${i}`,
  }))

const bigHarness = (input: { readonly count: number; readonly attached?: boolean }): Harness => {
  const h = makeHarness({
    listSessions: async () =>
      `${manyCandidates(input.count)
        .map((c) => `${c.sessionName} [Created 1m ago]`)
        .join("\n")}\n`,
  })
  h.candidates.length = 0
  h.candidates.push(...manyCandidates(input.count))
  // A session name nothing derived, so it tightens the budget (there IS a bridge
  // somewhere) without removing any candidate from the target set.
  if (input.attached === true) h.attached.push("a-terminal-somebody-has-open")
  return h
}

// Every read is a zellij client connecting, and zellij repaints in full for its
// attached clients when one does — so the budget counts `list-panes` and
// `list-sessions` alongside the dumps. Anything uncounted is a repaint the user
// gets for free, which is what turned a pass into a two-second freeze.
const readsIn = (h: Harness): number => h.paneListed.length + h.dumped.length + 1

describe("createTerminalPoller.tick read budget", () => {
  it("counts the pane lists and the session list, not only the dumps", async () => {
    const h = bigHarness({ count: MAX_READS_PER_PASS * 3 })
    await makePoller(h).tick()
    expect(readsIn(h)).toBeLessThanOrEqual(MAX_READS_PER_PASS)
    // Proof the budget is the thing that stopped it, not the candidate list.
    expect(h.dumped.length).toBeLessThan(MAX_READS_PER_PASS * 3)
  })

  it("spends far less per pass while a terminal WebSocket is attached", async () => {
    const watched = bigHarness({ count: MAX_READS_PER_PASS * 3, attached: true })
    await makePoller(watched).tick()
    expect(readsIn(watched)).toBeLessThanOrEqual(MAX_READS_PER_PASS_WATCHED)
  })

  it("starts the next pass where the last one stopped, so nothing is invisible forever", async () => {
    const h = bigHarness({ count: MAX_READS_PER_PASS * 3 })
    const poller = makePoller(h)
    await poller.tick()
    expect(h.dumped[0]).toBe("s0/terminal_0")
    const covered = h.dumped.length
    h.dumped.length = 0
    // Same screen everywhere, so pass 2 would have nothing due at all — the
    // rotation is what this asserts, so keep every target due.
    h.setDump(" ⠙ Working...")
    await poller.tick()
    expect(h.dumped[0]).toBe(`s${covered}/terminal_0`)
  })

  it("never leaves a session half-dumped — a partial pane set would fold to a wrong row", async () => {
    // Two panes each, so the budget cuts mid-session unless whole sessions are
    // skipped. Every session that produced any row must have produced both.
    const h = bigHarness({ count: MAX_READS_PER_PASS })
    const twoPane = { ...h.ports, listPanes: async () => TWO_PANE_LIST }
    await createTerminalPoller({ ports: twoPane, tailMaxChars: 8_000 }).tick()
    const perSession = new Map<string, number>()
    for (const d of h.dumped) {
      const name = d.split("/")[0] ?? ""
      perSession.set(name, (perSession.get(name) ?? 0) + 1)
    }
    expect([...perSession.values()].every((n) => n === 2)).toBe(true)
    expect(readsIn(h)).toBeLessThanOrEqual(MAX_READS_PER_PASS)
  })

  // The pass used to be able to spend its last read on a `list-panes` for a
  // session it could no longer afford to dump: a connection made, every open
  // terminal repainted, and nothing classified.
  it("does not spend its last read on a pane list it cannot afford to dump", async () => {
    const h = bigHarness({ count: MAX_READS_PER_PASS, attached: true })
    await makePoller(h).tick()
    // One dump for every pane list — never a list with no dump behind it.
    expect(h.paneListed.length).toBe(h.dumped.length)
  })
})

// A pane set changes when somebody opens or closes a pane, which is rare next to
// the poll interval — so re-listing every pass doubled the connection count of an
// ordinary pass for no news.
describe("createTerminalPoller.tick pane list cache", () => {
  const changingDump = (h: Harness, pass: number): void => {
    // Keep the screen moving so the target stays due every pass; the cache is what
    // is under test here, not the backoff.
    h.setDump(` ⠋ Working... ${pass}`)
  }

  it("lists panes once and reuses it for the whole refresh window", async () => {
    const h = makeHarness()
    const poller = makePoller(h)
    for (let pass = 1; pass <= PANE_LIST_REFRESH_PASSES; pass += 1) {
      changingDump(h, pass)
      await poller.tick()
    }
    // Two candidate sessions, one list each, however many passes ran.
    expect(h.paneListed).toEqual(["default", "abcd1234"])
    expect(h.dumped.length).toBe(2 * PANE_LIST_REFRESH_PASSES)
  })

  it("re-lists once the window is over, so a new pane cannot stay invisible", async () => {
    const h = makeHarness()
    const poller = makePoller(h)
    for (let pass = 1; pass <= PANE_LIST_REFRESH_PASSES + 1; pass += 1) {
      changingDump(h, pass)
      await poller.tick()
    }
    expect(h.paneListed).toEqual(["default", "abcd1234", "default", "abcd1234"])
  })

  // A pane that has gone away dumps nothing, and trusting the cache after that
  // would keep spending a read on it — and keep its row — for the rest of the
  // window.
  it("drops a cached list as soon as one of its panes dumps nothing", async () => {
    const h = makeHarness()
    const poller = makePoller(h)
    await poller.tick()
    expect(h.paneListed).toEqual(["default", "abcd1234"])
    h.setDump("")
    await poller.tick()
    h.setDump(" ⠋ Working...")
    await poller.tick()
    // Pass 2 spent no list at all — the cache was still inside its window, and it
    // is the empty DUMP that dropped it. Pass 3 therefore re-lists both.
    expect(h.paneListed).toEqual(["default", "abcd1234", "default", "abcd1234"])
  })

  // Only a fresh list is evidence about which panes exist. Pruning rows against a
  // cached list would delete a live pane's row.
  it("prunes pane rows only off a list it actually fetched", async () => {
    const h = makeHarness({ listPanes: async () => TWO_PANE_LIST })
    const poller = makePoller(h)
    await poller.tick()
    const afterFirst = h.forgotten.length
    expect(afterFirst).toBeGreaterThan(0)
    h.setDump(" ⠙ Working...")
    await poller.tick()
    expect(h.forgotten.length).toBe(afterFirst)
  })
})

// The reads are what repaint the user's open terminals, so a read that can only
// confirm an unchanged screen is pure cost. On a real machine most terminals are
// exactly that: a shell at a prompt, or an agent that finished hours ago.
describe("createTerminalPoller.tick backoff on a quiet screen", () => {
  // Quiet takes two reads to establish: the first read of a terminal has nothing
  // to compare against, so it always counts as movement. Pass 2 is the one that
  // finds the screen unchanged and halves the rate, so pass 3 is the first skip.
  it("stops re-reading a screen that is not moving", async () => {
    const h = makeHarness()
    const poller = makePoller(h)
    await poller.tick()
    expect(h.dumped.length).toBe(2)
    await poller.tick()
    expect(h.dumped.length).toBe(4)
    await poller.tick()
    expect(h.dumped.length).toBe(4)
  })

  it("comes straight back to every pass as soon as the screen moves again", async () => {
    const h = makeHarness()
    const poller = makePoller(h)
    await poller.tick()
    await poller.tick() // quiet: backed off to every 2nd pass
    await poller.tick() // skipped
    h.setDump(" ⠙ Working... now with output")
    await poller.tick() // pass 4: due again, and the screen moved
    const afterMove = h.dumped.length
    expect(afterMove).toBe(6)
    await poller.tick() // pass 5: due, because pass 4 saw movement
    expect(h.dumped.length).toBe(8)
  })

  // A working agent's screen churns every frame while its CLASSIFICATION sits at
  // `working` pass after pass. Backing off on the classification would starve the
  // busiest terminal — the one somebody is most likely waiting on — so the signal
  // is the screen, not the slug.
  it("keeps reading a busy terminal whose classification never changes", async () => {
    const h = makeHarness()
    const poller = makePoller(h)
    for (let pass = 1; pass <= 4; pass += 1) {
      h.setDump(` ⠋ Working... frame ${pass}`)
      await poller.tick()
    }
    expect(h.dumped.length).toBe(8)
    // One transition, on the first pass — every later pass agreed with it.
    expect(h.published.filter((p) => p.id === "abcd1234")).toHaveLength(1)
  })

  // `pid wait --until-output` resolves off these passes and nothing else, so a
  // backed-off target would silently add latency to a wait that advertises the
  // poll interval.
  it("suspends the backoff while a screen wait is pending", async () => {
    let waiting = false
    const h = makeHarness({ hasScreenWaiters: () => waiting })
    const poller = makePoller(h)
    await poller.tick()
    await poller.tick() // pass 2 finds both quiet
    await poller.tick() // pass 3 skips both
    expect(h.dumped.length).toBe(4)
    waiting = true
    // Every pass reads everything again for as long as something is waiting.
    await poller.tick()
    expect(h.dumped.length).toBe(6)
    await poller.tick()
    expect(h.dumped.length).toBe(8)
  })

  it("still offers an unchanged screen to output waits on every read", async () => {
    let waiting = true
    const h = makeHarness({ hasScreenWaiters: () => waiting })
    const poller = makePoller(h)
    await poller.tick()
    await poller.tick()
    waiting = false
    // Both passes read both terminals, and every read was offered — an output
    // pattern can match a line that appears while the classification holds still.
    expect(h.noted.length).toBe(4)
  })

  // A dump that fails or comes back empty is not a read: advancing the backoff on
  // it would let a session that cannot be dumped talk itself down to one attempt
  // every MAX_BACKOFF_PASSES.
  it("does not back off a target it failed to read", async () => {
    const h = makeHarness()
    const poller = makePoller(h)
    h.setDump("")
    await poller.tick()
    expect(h.dumped.length).toBe(2)
    await poller.tick()
    expect(h.dumped.length).toBe(4)
  })

  // A terminal the user opens in the browser leaves the target set (the WS tap
  // owns that screen), and must be due again the moment it comes back.
  it("forgets a target's cadence while it is attached, so a detach re-reads at once", async () => {
    const h = makeHarness()
    const poller = makePoller(h)
    // Four passes of an unchanging screen: both targets are now backed off to a
    // read every 4th pass, next due on pass 8.
    for (let pass = 1; pass <= 4; pass += 1) await poller.tick()
    const beforeAttach = h.dumped.filter((d) => d.startsWith("abcd1234/")).length
    h.attached.push("abcd1234")
    await poller.tick() // pass 5: attached, so not a target at all
    expect(h.dumped.filter((d) => d.startsWith("abcd1234/")).length).toBe(beforeAttach)
    h.attached.length = 0
    await poller.tick() // pass 6: detached — and pass 6 is inside the backed-off window
    expect(h.dumped.filter((d) => d.startsWith("abcd1234/")).length).toBe(beforeAttach + 1)
    // The other target was never attached, so it is still backed off on pass 6 —
    // which is what makes the line above about the eviction and not about the pass.
    expect(h.dumped.filter((d) => d.startsWith("default/")).length).toBe(beforeAttach)
  })
})

// The sessions routes refuse an `untilOutput` wait when this is false, rather
// than accepting a request nothing can ever satisfy.
describe("createTerminalPoller.isEnabled", () => {
  it("is false before start — importing a module must not look armed", () => {
    expect(makePoller(makeHarness()).isEnabled()).toBe(false)
  })

  it("is true once started with a positive interval, and false again after stop", () => {
    const poller = makePoller(makeHarness())
    poller.start({ intervalMs: 60_000 })
    expect(poller.isEnabled()).toBe(true)
    poller.stop()
    expect(poller.isEnabled()).toBe(false)
  })

  it.each([0, -1, Number.NaN])("stays false for the disabling interval %p", (intervalMs) => {
    const poller = makePoller(makeHarness())
    poller.start({ intervalMs })
    expect(poller.isEnabled()).toBe(false)
    poller.stop()
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
