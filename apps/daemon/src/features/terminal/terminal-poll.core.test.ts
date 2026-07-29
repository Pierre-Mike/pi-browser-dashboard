import { describe, expect, it } from "bun:test"
import {
  foldScreenDump,
  type PollCandidate,
  parseSessionList,
  parseTerminalPaneIds,
  selectPollTargets,
  zellijDumpScreenArgv,
  zellijListPanesArgv,
  zellijListSessionsArgv,
} from "./terminal-poll.core"

// Verbatim `zellij list-sessions --no-formatting` output (zellij 0.44.3).
const SESSION_LIST = `default [Created 12h 5m 14s ago]
Orchestrator [Created 29m ago]
b8465f3b [Created 1day 1h 33m 22s ago] (current)
edfe61ab [Created 1day 11h 34m 32s ago] (EXITED - attach to resurrect)
`

// Verbatim `zellij --session <name> action list-panes` output for a session
// created from the daemon's own layout (tab-bar + status-bar plugin panes
// around one content terminal pane).
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
