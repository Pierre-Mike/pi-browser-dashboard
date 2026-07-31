import { describe, expect, it } from "bun:test"
import {
  advanceCadence,
  advancePassOffset,
  backoffPasses,
  foldPaneReadings,
  foldScreenDump,
  isPaneListFresh,
  isTargetDue,
  MAX_BACKOFF_PASSES,
  MAX_READS_PER_PASS,
  MAX_READS_PER_PASS_WATCHED,
  PANE_LIST_REFRESH_PASSES,
  type PaneReading,
  type PollCadence,
  type PollCandidate,
  parseSessionList,
  parseTerminalPaneIds,
  parseTerminalPaneRows,
  pollCadenceKey,
  readBudgetForPass,
  rotateTargets,
  screenFingerprint,
  selectDueTargets,
  selectPanesToDump,
  selectPollTargets,
  stalePaneKeys,
  zellijDumpScreenArgv,
  zellijListPanesArgv,
  zellijListSessionsArgv,
} from "./terminal-poll.core"
import type { TerminalStateSlug } from "./terminal-state.core"

// Verbatim `zellij list-sessions --no-formatting` output (zellij 0.44.3).
const SESSION_LIST = `default [Created 12h 5m 14s ago]
Orchestrator [Created 29m ago]
b8465f3b [Created 1day 1h 33m 22s ago] (current)
edfe61ab [Created 1day 11h 34m 32s ago] (EXITED - attach to resurrect)
`

// Verbatim `zellij --session <name> action list-panes` output for a session that
// holds a plugin pane beside its content pane. The daemon's own layouts stopped
// emitting plugin panes (they were zellij-themed chrome the dashboard could not
// repaint), but a human can still open one — and a session the daemon merely
// derived was never guaranteed to be one the daemon created. So the fixture keeps
// the `plugin` row: it is what the filter exists for.
const PANE_LIST = `PANE_ID  TYPE  TITLE
plugin_1  plugin  zellij:status-bar
terminal_0  terminal  bash -lc claude attach abcd1234; exec bash -l
`

describe("parseSessionList", () => {
  it("reads one name per line and flags the resurrectable ones", () => {
    expect(parseSessionList(SESSION_LIST)).toEqual([
      { name: "default", exited: false },
      { name: "Orchestrator", exited: false },
      { name: "b8465f3b", exited: false },
      { name: "edfe61ab", exited: true },
    ])
  })

  it("survives the coloured output too — the --no-formatting flag is belt, this is braces", () => {
    const coloured = "[32;1mdefault[m [Created 1m ago] \n"
    expect(parseSessionList(coloured)).toEqual([{ name: "default", exited: false }])
  })

  it("is empty for no sessions at all", () => {
    expect(parseSessionList("")).toEqual([])
    expect(parseSessionList("\n  \n")).toEqual([])
  })
})

// zellij keeps every dead session listed until it is resurrected or reaped, so
// the list the poller parses every pass only ever grows: 598 lines on the
// machine this was written on, 558 of them EXITED. Worth measuring before
// optimising, and the measurement said don't — that real list parses in 0.31ms
// and the growth is flatly linear (0.57ms at 1196 lines, 1.14ms at 2392,
// 2.23ms at 4784). Against a 15s poll interval that is 0.002% of a core, so the
// exited entries are left in place and this budget only guards the cost's
// SHAPE: the same slice has already shipped one matcher whose per-line work
// exploded (see the `classifyTail cost` block next door), and a linear parser
// that quietly becomes a quadratic one would show up here.
const bulkSessionList = (lines: number): string => {
  const rows: string[] = []
  for (let i = 0; i < lines; i++) {
    rows.push(
      i % 16 === 0
        ? `live${i} [Created ${i}h 5m 14s ago]`
        : `dead${i} [Created 2months 1day 7h 23m 28s ago] (EXITED - attach to resurrect)`,
    )
  }
  return `${rows.join("\n")}\n`
}

const fastestMs = (args: { readonly runs: number; readonly fn: () => void }): number => {
  let best = Number.POSITIVE_INFINITY
  for (let i = 0; i < args.runs; i++) {
    const started = performance.now()
    args.fn()
    best = Math.min(best, performance.now() - started)
  }
  return best
}

describe("parseSessionList cost", () => {
  // An order of magnitude above the ~1.1ms measured at this size, so a loaded
  // runner cannot flake it.
  const BUDGET_MS = 15
  const FOUR_X = bulkSessionList(2400)

  it("parses a list four times the size of a real long-lived machine's in linear time", () => {
    const parsed = parseSessionList(FOUR_X)
    expect(parsed).toHaveLength(2400)
    expect(parsed.filter((s) => !s.exited)).toHaveLength(2400 / 16)
    const ms = fastestMs({
      runs: 5,
      fn: () => {
        parseSessionList(FOUR_X)
      },
    })
    expect(ms).toBeLessThan(BUDGET_MS)
  })

  it("selects poll targets from that list without scanning it per candidate", () => {
    const sessions = parseSessionList(FOUR_X)
    const candidates: PollCandidate[] = sessions
      .filter((s) => !s.exited)
      .map((s) => ({ scope: "session" as const, id: s.name, sessionName: s.name }))
    expect(selectPollTargets({ candidates, sessions, attachedSessionNames: [] })).toHaveLength(
      candidates.length,
    )
    const ms = fastestMs({
      runs: 5,
      fn: () => {
        selectPollTargets({ candidates, sessions, attachedSessionNames: [] })
      },
    })
    expect(ms).toBeLessThan(BUDGET_MS)
  })
})

describe("parseTerminalPaneIds", () => {
  it("keeps terminal panes, drops plugin panes and the header row", () => {
    expect(parseTerminalPaneIds(PANE_LIST)).toEqual(["terminal_0"])
  })

  it("orders panes by their index so the layout's original pane comes first", () => {
    const raw = `PANE_ID  TYPE  TITLE
terminal_12  terminal  bash
terminal_2  terminal  bash
terminal_0  terminal  claude
`
    expect(parseTerminalPaneIds(raw)).toEqual(["terminal_0", "terminal_2", "terminal_12"])
  })

  it("is empty when a session has no terminal pane", () => {
    expect(
      parseTerminalPaneIds("PANE_ID  TYPE  TITLE\nplugin_1  plugin  zellij:status-bar\n"),
    ).toEqual([])
    expect(parseTerminalPaneIds("")).toEqual([])
  })
})

describe("selectPollTargets", () => {
  const candidates: ReadonlyArray<PollCandidate> = [
    { scope: "global", id: "global", sessionName: "default" },
    { scope: "orchestrator", id: "orchestrator", sessionName: "Orchestrator" },
    { scope: "session", id: "abcd1234", sessionName: "abcd1234" },
    { scope: "project", id: "my-repo", sessionName: "my-repo" },
  ]
  const sessions = parseSessionList(SESSION_LIST)

  it("polls only sessions that both exist and belong to this daemon", () => {
    // "abcd1234" and "my-repo" are candidates the daemon owns but no zellij
    // session by those names is running, so there is nothing to dump.
    expect(
      selectPollTargets({ candidates, sessions, attachedSessionNames: [] }).map(
        (t) => t.sessionName,
      ),
    ).toEqual(["default", "Orchestrator"])
  })

  it("never polls a session name the daemon did not derive", () => {
    // b8465f3b is live on this machine but is not one of ours — a second
    // daemon's session, or one the user made by hand.
    expect(
      selectPollTargets({ candidates, sessions, attachedSessionNames: [] }).map(
        (t) => t.sessionName,
      ),
    ).not.toContain("b8465f3b")
  })

  it("skips a session that already has a live WS bridge", () => {
    // The bridge classifies byte-accurately; polling the same screen would
    // only fight it.
    expect(
      selectPollTargets({ candidates, sessions, attachedSessionNames: ["default"] }).map(
        (t) => t.sessionName,
      ),
    ).toEqual(["Orchestrator"])
  })

  it("skips an EXITED (resurrectable) session", () => {
    expect(
      selectPollTargets({
        candidates: [{ scope: "session", id: "edfe61ab", sessionName: "edfe61ab" }],
        sessions,
        attachedSessionNames: [],
      }),
    ).toEqual([])
  })

  it("dumps a session name only once even when two candidates resolve to it", () => {
    const dupes: ReadonlyArray<PollCandidate> = [
      { scope: "session", id: "abcd1234", sessionName: "default" },
      { scope: "global", id: "global", sessionName: "default" },
    ]
    const picked = selectPollTargets({ candidates: dupes, sessions, attachedSessionNames: [] })
    expect(picked).toEqual([{ scope: "session", id: "abcd1234", sessionName: "default" }])
  })
})

// The rows behind parseTerminalPaneIds. The title is what lets the write surface
// check that a pane still carries the name the daemon minted for it before
// closing it (terminal-panes.core.ts).
describe("parseTerminalPaneRows", () => {
  it("carries each terminal pane's title, and drops plugin rows and the header", () => {
    expect(parseTerminalPaneRows(PANE_LIST)).toEqual([
      { paneId: "terminal_0", title: "bash -lc claude attach abcd1234; exec bash -l" },
    ])
  })

  it("keeps a minted pane name intact", () => {
    const raw = `PANE_ID  TYPE  TITLE
terminal_3  terminal  pid-pane-1
`
    expect(parseTerminalPaneRows(raw)).toEqual([{ paneId: "terminal_3", title: "pid-pane-1" }])
  })

  it("is empty for a title-less row rather than dropping the pane", () => {
    expect(parseTerminalPaneRows("PANE_ID  TYPE  TITLE\nterminal_0  terminal\n")).toEqual([
      { paneId: "terminal_0", title: "" },
    ])
  })
})

describe("selectPanesToDump", () => {
  const eight = ["terminal_0", "terminal_1", "terminal_2", "terminal_3", "terminal_4"]

  it("keeps every pane of an ordinary session untouched", () => {
    expect(selectPanesToDump({ paneIds: ["terminal_0", "terminal_1"], maxPanes: 4 })).toEqual([
      "terminal_0",
      "terminal_1",
    ])
  })

  it("caps a pane wall at the budget, keeping the lowest pane indexes", () => {
    // parseTerminalPaneIds already sorted them, so "first N" means the panes the
    // layout opened first — the ones an agent was most likely started in.
    expect(selectPanesToDump({ paneIds: eight, maxPanes: 3 })).toEqual([
      "terminal_0",
      "terminal_1",
      "terminal_2",
    ])
  })

  it("is empty for no panes, and for a nonsensical budget", () => {
    expect(selectPanesToDump({ paneIds: [], maxPanes: 4 })).toEqual([])
    expect(selectPanesToDump({ paneIds: eight, maxPanes: 0 })).toEqual([])
    expect(selectPanesToDump({ paneIds: eight, maxPanes: -1 })).toEqual([])
  })
})

// THE session-level decision. Panes disagree constantly (an agent generating in
// one pane, a shell resting in another), and every screen-derived feature —
// chips, `wait --via screen`, `explain`, rules — reads the session-level row.
// See foldPaneReadings' own comment for why `blocked` wins.
describe("foldPaneReadings", () => {
  const reading = (input: {
    readonly paneId: string
    readonly state: TerminalStateSlug
  }): PaneReading => ({
    paneId: input.paneId,
    state: input.state,
    matcher: `${input.state}-matcher`,
    evidence: `${input.paneId} says ${input.state}`,
  })

  it("is undefined when no pane could be read at all", () => {
    expect(foldPaneReadings({ panes: [] })).toBeUndefined()
  })

  it("is the pane's own reading, verbatim, for a single-pane session", () => {
    const only = reading({ paneId: "terminal_0", state: "working" })
    expect(foldPaneReadings({ panes: [only] })).toEqual(only)
  })

  // The interesting case, spelled out: one blocked pane, two working ones.
  it("reports blocked when one pane is blocked and the others are working", () => {
    const folded = foldPaneReadings({
      panes: [
        reading({ paneId: "terminal_0", state: "working" }),
        reading({ paneId: "terminal_1", state: "blocked" }),
        reading({ paneId: "terminal_2", state: "working" }),
      ],
    })
    expect(folded?.state).toBe("blocked")
    // And it names the pane it read that from — the row is a citation, never a
    // synthesized summary, so the evidence still belongs to a real screen.
    expect(folded?.paneId).toBe("terminal_1")
    expect(folded?.evidence).toBe("terminal_1 says blocked")
  })

  it("prefers working over idle — a resting shell must not mask a running agent", () => {
    const folded = foldPaneReadings({
      panes: [
        reading({ paneId: "terminal_0", state: "idle" }),
        reading({ paneId: "terminal_1", state: "working" }),
      ],
    })
    expect(folded?.state).toBe("working")
    expect(folded?.paneId).toBe("terminal_1")
  })

  it("prefers any real classification over unknown — no matcher firing is not evidence", () => {
    const folded = foldPaneReadings({
      panes: [
        reading({ paneId: "terminal_0", state: "unknown" }),
        reading({ paneId: "terminal_1", state: "idle" }),
      ],
    })
    expect(folded?.state).toBe("idle")
  })

  it("is unknown only when every pane is unknown", () => {
    const folded = foldPaneReadings({
      panes: [
        reading({ paneId: "terminal_0", state: "unknown" }),
        reading({ paneId: "terminal_1", state: "unknown" }),
      ],
    })
    expect(folded?.state).toBe("unknown")
    expect(folded?.paneId).toBe("terminal_0")
  })

  it("breaks a tie on the lowest pane index, so a stable screen gives a stable row", () => {
    const folded = foldPaneReadings({
      panes: [
        reading({ paneId: "terminal_0", state: "working" }),
        reading({ paneId: "terminal_1", state: "working" }),
      ],
    })
    expect(folded?.paneId).toBe("terminal_0")
  })
})

// Pane rows outlive their pane: a pane the user closed would otherwise sit in
// GET /terminal/states forever, and a stale `blocked` row is exactly the
// misinformation per-pane classification exists to remove.
describe("stalePaneKeys", () => {
  const keys = [
    "session:ab12",
    "session:ab12#terminal_0",
    "session:ab12#terminal_1",
    "session:ab12x#terminal_0",
    "project:ab12#terminal_0",
    "global:global",
  ]

  it("drops the pane rows of panes that are gone", () => {
    expect(
      stalePaneKeys({ keys, scope: "session", id: "ab12", keepPaneIds: ["terminal_0"] }),
    ).toEqual(["session:ab12#terminal_1"])
  })

  it("never drops the session-level row, whatever is live", () => {
    expect(stalePaneKeys({ keys, scope: "session", id: "ab12", keepPaneIds: [] })).not.toContain(
      "session:ab12",
    )
  })

  it("drops every pane row when the terminal should have none", () => {
    // What a session dropping back to one pane looks like: pane rows only exist
    // while there is more than one pane to disagree.
    expect(stalePaneKeys({ keys, scope: "session", id: "ab12", keepPaneIds: [] })).toEqual([
      "session:ab12#terminal_0",
      "session:ab12#terminal_1",
    ])
  })

  it("touches no other terminal's rows — not another scope, not a longer id", () => {
    const dropped = stalePaneKeys({ keys, scope: "session", id: "ab12", keepPaneIds: [] })
    expect(dropped).not.toContain("project:ab12#terminal_0")
    expect(dropped).not.toContain("session:ab12x#terminal_0")
    expect(dropped).not.toContain("global:global")
  })
})

// One pass is bounded (MAX_READS_PER_PASS). A bound that always truncated the
// same tail of the candidate list would make those terminals permanently
// invisible — the exact blind spot per-pane polling exists to remove — so the
// pass starts where the last one stopped instead.
describe("rotateTargets / advancePassOffset", () => {
  const targets: ReadonlyArray<PollCandidate> = ["a", "b", "c", "d"].map((n) => ({
    scope: "session" as const,
    id: n,
    sessionName: n,
  }))
  const ids = (list: ReadonlyArray<PollCandidate>): ReadonlyArray<string> => list.map((t) => t.id)

  it("starts at the offset and wraps once", () => {
    expect(ids(rotateTargets({ targets, offset: 2 }))).toEqual(["c", "d", "a", "b"])
  })

  it("is the identity at offset 0, and for an offset past the end", () => {
    expect(ids(rotateTargets({ targets, offset: 0 }))).toEqual(["a", "b", "c", "d"])
    expect(ids(rotateTargets({ targets, offset: 4 }))).toEqual(["a", "b", "c", "d"])
    expect(ids(rotateTargets({ targets, offset: 9 }))).toEqual(["b", "c", "d", "a"])
  })

  it("survives an empty list and a negative offset rather than producing holes", () => {
    expect(rotateTargets({ targets: [], offset: 3 })).toEqual([])
    expect(ids(rotateTargets({ targets, offset: -1 }))).toEqual(["a", "b", "c", "d"])
  })

  it("advances by however many targets the pass actually reached", () => {
    expect(advancePassOffset({ offset: 0, visited: 2, total: 4 })).toBe(2)
    expect(advancePassOffset({ offset: 3, visited: 3, total: 4 })).toBe(2)
  })

  it("returns to 0 once a pass covered everything, so a small machine never rotates", () => {
    expect(advancePassOffset({ offset: 0, visited: 4, total: 4 })).toBe(0)
    expect(advancePassOffset({ offset: 0, visited: 0, total: 0 })).toBe(0)
  })
})

describe("foldScreenDump", () => {
  const maxChars = 8_000

  it("classifies a dumped screen the same way the WS tap classifies bytes", () => {
    const folded = foldScreenDump({
      dump: "> run the tests\n[38;2;220;129;97mBurrowing…(3s · ↓4 tokens)[m",
      prior: undefined,
      maxChars,
    })
    expect(folded.classification.state).toBe("working")
    expect(folded.classification.matcher).toBe("thinking-gerund")
    expect(folded.publish).toBe(true)
  })

  it("does not publish when the state is unchanged", () => {
    const folded = foldScreenDump({ dump: " ⠋ Working...", prior: "working", maxChars })
    expect(folded.classification.state).toBe("working")
    expect(folded.publish).toBe(false)
  })

  // The load-bearing design decision. A dump is a full SNAPSHOT of the
  // viewport, so it REPLACES the tail rather than being appended to it. If
  // successive dumps accumulated, `classifyTail`'s first-match-wins ordering
  // would let one stale permission prompt outrank the live spinner forever.
  it("treats each dump as a whole snapshot, so a stale screen cannot outrank the current one", () => {
    const blocked = foldScreenDump({
      // The dialog's question line AND its option list — the header alone is a
      // sentence any screen can print, so it no longer classifies as blocked.
      // These two lines are verbatim from the live capture kept in
      // terminal-state.core.test.ts.
      dump: " Do you want to proceed?\n ❯ 1. Yes\n   2. No",
      prior: undefined,
      maxChars,
    })
    expect(blocked.classification.state).toBe("blocked")

    // The very next dump, after the human answered, shows work in progress and
    // no trace of the dialog. State must follow the screen, not its history.
    const working = foldScreenDump({ dump: " ⠋ Working...", prior: "blocked", maxChars })
    expect(working.classification.state).toBe("working")
    expect(working.publish).toBe(true)
  })

  it("keeps the BOTTOM of an oversized screen — that is where every status line lives", () => {
    const dump = `${"scrollback\n".repeat(500)} ⠋ Working...`
    const folded = foldScreenDump({ dump, prior: undefined, maxChars: 40 })
    expect(folded.classification.state).toBe("working")
  })

  it("is honestly unknown for a screen nothing matches", () => {
    const folded = foldScreenDump({ dump: "pierre@host ~ %", prior: undefined, maxChars })
    expect(folded.classification.state).toBe("unknown")
    expect(folded.classification.matcher).toBeUndefined()
  })
})

describe("zellij argv builders", () => {
  it("asks list-sessions for parseable output", () => {
    expect(zellijListSessionsArgv()).toEqual(["zellij", "list-sessions", "--no-formatting"])
  })

  it("targets a session explicitly rather than relying on an ambient one", () => {
    expect(zellijListPanesArgv({ sessionName: "abcd1234" })).toEqual([
      "zellij",
      "--session",
      "abcd1234",
      "action",
      "list-panes",
    ])
  })

  // Verified against zellij 0.44.3: `dump-screen` with no --pane-id dumps the
  // FOCUSED pane, and a session with zero attached clients has no focused
  // pane, so it prints nothing and exits 0. The pane id is what makes a
  // client-less dump work at all.
  it("always passes --pane-id, which is what makes a client-less dump work", () => {
    expect(zellijDumpScreenArgv({ sessionName: "abcd1234", paneId: "terminal_0" })).toEqual([
      "zellij",
      "--session",
      "abcd1234",
      "action",
      "dump-screen",
      "--pane-id",
      "terminal_0",
    ])
  })
})

// Every read this poller makes is a zellij client connecting, and zellij answers
// a connection by repainting in full for its attached clients — cross-session, so
// a read against one terminal repaints another. Measured on 0.44.3: ~1-2
// full-screen repaints per connection. These are the two dials that keep a pass
// from arriving in a watched browser terminal as a two-second freeze.
describe("readBudgetForPass", () => {
  it("tightens the budget exactly while a terminal WebSocket is attached", () => {
    expect(readBudgetForPass({ watched: true })).toBe(MAX_READS_PER_PASS_WATCHED)
    expect(readBudgetForPass({ watched: false })).toBe(MAX_READS_PER_PASS)
  })

  // The watched budget is the one a browser has to absorb inside one interval. If
  // it ever grows to the unwatched number the freeze is back, so the ordering is
  // the assertion — not the literals, which are free to be retuned.
  it("spends strictly less while watched than while nobody is looking", () => {
    expect(MAX_READS_PER_PASS_WATCHED).toBeLessThan(MAX_READS_PER_PASS)
    expect(MAX_READS_PER_PASS_WATCHED).toBeGreaterThan(1)
  })
})

describe("backoffPasses", () => {
  it("doubles per quiet read and then holds at the ceiling", () => {
    expect(backoffPasses({ quietPasses: 0 })).toBe(1)
    expect(backoffPasses({ quietPasses: 1 })).toBe(2)
    expect(backoffPasses({ quietPasses: 2 })).toBe(4)
    expect(backoffPasses({ quietPasses: 3 })).toBe(MAX_BACKOFF_PASSES)
    expect(backoffPasses({ quietPasses: 99 })).toBe(MAX_BACKOFF_PASSES)
  })

  // A garbage count must read as "poll it now", never as "never poll it again":
  // 2 ** NaN is NaN, and `pass >= NaN` is false forever.
  it.each([
    -1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ])("degrades a nonsense quiet count (%p) to every pass", (quietPasses) => {
    const passes = backoffPasses({ quietPasses })
    expect(Number.isFinite(passes)).toBe(true)
    expect(passes).toBeGreaterThanOrEqual(1)
  })
})

describe("isTargetDue", () => {
  it("reads an unknown target as due — a new terminal is classified on sight", () => {
    expect(isTargetDue({ cadence: undefined, pass: 7 })).toBe(true)
  })

  it("is due on and after its scheduled pass, and not before", () => {
    const cadence: PollCadence = { quietPasses: 2, nextDuePass: 10 }
    expect(isTargetDue({ cadence, pass: 9 })).toBe(false)
    expect(isTargetDue({ cadence, pass: 10 })).toBe(true)
    expect(isTargetDue({ cadence, pass: 11 })).toBe(true)
  })
})

describe("advanceCadence", () => {
  it("resets to every pass the moment a screen moves", () => {
    expect(
      advanceCadence({ cadence: { quietPasses: 3, nextDuePass: 4 }, pass: 12, changed: true }),
    ).toEqual({ quietPasses: 0, nextDuePass: 13 })
  })

  it("halves the rate on the first quiet read rather than dropping to the ceiling", () => {
    // A terminal that pauses for one interval mid-run must not go stale for the
    // full backoff window.
    expect(advanceCadence({ cadence: undefined, pass: 1, changed: false })).toEqual({
      quietPasses: 1,
      nextDuePass: 3,
    })
  })

  it("compounds over consecutive quiet reads up to the ceiling", () => {
    let cadence = advanceCadence({ cadence: undefined, pass: 1, changed: false })
    const schedule = [cadence.nextDuePass]
    for (let pass = 2; pass <= 6; pass += 1) {
      cadence = advanceCadence({ cadence, pass, changed: false })
      schedule.push(cadence.nextDuePass)
    }
    // Read as "after the pass numbered N, come back at": 1->3, 2->6, then the
    // ceiling holds the gap at MAX_BACKOFF_PASSES from whenever the read happened.
    expect(schedule).toEqual([3, 6, 11, 12, 13, 14])
    expect(cadence.nextDuePass - 6).toBe(MAX_BACKOFF_PASSES)
  })
})

describe("selectDueTargets", () => {
  const targets: ReadonlyArray<PollCandidate> = ["a", "b", "c"].map((n) => ({
    scope: "session" as const,
    id: n,
    sessionName: n,
  }))
  const cadences = new Map<string, PollCadence>([
    [pollCadenceKey({ scope: "session", id: "a" }), { quietPasses: 3, nextDuePass: 99 }],
    [pollCadenceKey({ scope: "session", id: "b" }), { quietPasses: 0, nextDuePass: 5 }],
  ])

  it("keeps the moving and the never-seen, and skips the backed-off", () => {
    const picked = selectDueTargets({ targets, pass: 5, cadences, ignoreBackoff: false })
    // `c` has no cadence at all — never read, so always due.
    expect(picked.map((t) => t.id)).toEqual(["b", "c"])
  })

  // An `untilOutput` wait resolves off these passes and nothing else, so a
  // backed-off target would add up to MAX_BACKOFF_PASSES of latency to a wait
  // that advertises the poll interval.
  it("suspends the backoff entirely while a screen wait is pending", () => {
    expect(
      selectDueTargets({ targets, pass: 5, cadences, ignoreBackoff: true }).map((t) => t.id),
    ).toEqual(["a", "b", "c"])
  })

  it("keys cadences the way terminal state keys rows, so the two cannot drift", () => {
    expect(pollCadenceKey({ scope: "project", id: "pi-browser-dashboard" })).toBe(
      "project:pi-browser-dashboard",
    )
  })
})

describe("screenFingerprint", () => {
  it("is stable for identical text and differs for a one-character change", () => {
    expect(screenFingerprint({ text: "hello" })).toBe(screenFingerprint({ text: "hello" }))
    expect(screenFingerprint({ text: "hello" })).not.toBe(screenFingerprint({ text: "hellp" }))
  })

  // The two screens a real terminal alternates between are usually the same length
  // (a spinner frame, a clock tick), so length alone would call them equal and
  // back the busiest terminal off. And the hash alone would collide on
  // transpositions, hence both.
  it("separates same-length screens and reorderings", () => {
    expect(screenFingerprint({ text: "⠋ Working" })).not.toBe(
      screenFingerprint({ text: "⠙ Working" }),
    )
    expect(screenFingerprint({ text: "ab" })).not.toBe(screenFingerprint({ text: "ba" }))
  })

  it("does not carry the screen text itself — it is a hash, not a copy", () => {
    const secret = "sk-live-0123456789"
    expect(screenFingerprint({ text: secret })).not.toContain("sk-live")
  })
})

describe("isPaneListFresh", () => {
  it("is stale when there is no entry at all", () => {
    expect(isPaneListFresh({ listedAtPass: undefined, pass: 3 })).toBe(false)
  })

  it("holds for the refresh window and expires on the pass after it", () => {
    expect(isPaneListFresh({ listedAtPass: 10, pass: 10 })).toBe(true)
    expect(isPaneListFresh({ listedAtPass: 10, pass: 10 + PANE_LIST_REFRESH_PASSES - 1 })).toBe(
      true,
    )
    expect(isPaneListFresh({ listedAtPass: 10, pass: 10 + PANE_LIST_REFRESH_PASSES })).toBe(false)
  })
})
