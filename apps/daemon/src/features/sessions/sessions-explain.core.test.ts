import { describe, expect, test } from "bun:test"
import { STALE_ACTIVE_MS } from "@pid/shared"
import type { SessionStateSlug } from "./sessions.core"
import { makeSessionState as makeSession } from "./sessions.testFixtures"
import { explainSession } from "./sessions-explain.core"

const NOW = 1_000_000

describe("explainSession — ordinary case", () => {
  test("a live, fresh, state.json-sourced working session gets exactly one reason", () => {
    const out = explainSession({
      session: makeSession({ state: "working" }),
      now: NOW,
      updatedAtMs: NOW - 1_000,
      lastEventAtMs: NOW - 500,
      pidAlive: true,
      stateFilePresent: true,
    })
    expect(out.stale).toBe(false)
    expect(out.reasons).toHaveLength(1)
    expect(out.reasons[0]).toContain("state.json")
    expect(out.updatedAtAgeMs).toBe(1_000)
    expect(out.lastEventAgeMs).toBe(500)
    expect(out.pidAlive).toBe(true)
    expect(out.stateFilePresent).toBe(true)
    expect(out.source).toBe("state.json")
    expect(out.degradedFrom).toBeUndefined()
  })
})

describe("explainSession — roster-seed source", () => {
  test("names the roster seed and explains what is still unknown", () => {
    const out = explainSession({
      session: makeSession({ state: "idle", source: "roster-seed" }),
      now: NOW,
      updatedAtMs: undefined,
      lastEventAtMs: undefined,
      pidAlive: undefined,
      stateFilePresent: false,
    })
    // stateFilePresent: false also fires its own reason for a roster-seed
    // session (state.json genuinely never existed yet), so assert on content
    // rather than array length here.
    expect(out.reasons.some((r) => r.includes("roster seed"))).toBe(true)
    expect(out.reasons.some((r) => r.includes("intent/cwd/sessionId"))).toBe(true)
  })
})

describe("explainSession — pi-spawn-log source", () => {
  test("names the pi spawn log rather than a supervisor state.json", () => {
    const out = explainSession({
      session: makeSession({ state: "working", source: "pi-spawn-log" }),
      now: NOW,
      updatedAtMs: NOW - 1_000,
      lastEventAtMs: undefined,
      pidAlive: true,
      stateFilePresent: false,
    })
    expect(out.source).toBe("pi-spawn-log")
    expect(out.reasons.some((r) => r.includes("pi spawn log"))).toBe(true)
  })

  // pi never had a state.json to lose — a pi session with no state file on
  // disk is normal, not a "gone file" the way it would be for a claude
  // session that used to have one.
  test("suppresses the 'state.json is gone' reason even when stateFilePresent is false", () => {
    const out = explainSession({
      session: makeSession({ state: "done", source: "pi-spawn-log" }),
      now: NOW,
      updatedAtMs: NOW - 1_000,
      lastEventAtMs: undefined,
      pidAlive: undefined,
      stateFilePresent: false,
    })
    expect(out.stateFilePresent).toBe(false)
    expect(out.reasons.some((r) => r.includes("no longer on disk"))).toBe(false)
  })

  // Every pi explanation carries the limit, not just the ones where it bites:
  // the two states the daemon can never derive for pi are exactly the ones a
  // caller polls for when a run seems stuck, so their absence must be stated
  // rather than read as "pi is definitely not waiting on you".
  test("states which slugs the daemon can never derive for a pi run", () => {
    const out = explainSession({
      session: makeSession({ state: "working", source: "pi-spawn-log" }),
      now: NOW,
      updatedAtMs: NOW - 1_000,
      lastEventAtMs: undefined,
      pidAlive: true,
      stateFilePresent: false,
      piTranscriptPresent: true,
      terminal: { state: "working", matcher: "pi-working", evidence: "⠇", atMs: NOW - 100 },
    })
    const limits = out.reasons.find((r) => r.includes("needs_input"))
    expect(limits).toBeDefined()
    expect(limits).toContain("blocked")
  })

  // Observed live twice over: a dispatched pi run whose transcript ends with an
  // assistant message reads "done" while pi is still running — once resting at
  // its prompt, once mid-tool-call with the screen reading "working". Saying
  // only "done" there would be this endpoint's worst lie.
  test("says a live pid under a 'done' state means the run has not ended", () => {
    const out = explainSession({
      session: makeSession({ state: "done", source: "pi-spawn-log" }),
      now: NOW,
      updatedAtMs: NOW - 1_000,
      lastEventAtMs: undefined,
      pidAlive: true,
      stateFilePresent: false,
      piTranscriptPresent: true,
    })
    const reason = out.reasons.find((r) => r.includes("has NOT ended"))
    expect(reason).toBeDefined()
    expect(reason).toContain("transcript")
    // Must not narrow to "resting at the prompt": a busy pi mid-tool-call
    // reads "done" the same way.
    expect(reason).toContain("mid-turn with a tool call in flight")
  })

  test("says nothing of the sort once the pi process is gone", () => {
    const out = explainSession({
      session: makeSession({ state: "done", source: "pi-spawn-log" }),
      now: NOW,
      updatedAtMs: NOW - 1_000,
      lastEventAtMs: undefined,
      pidAlive: false,
      stateFilePresent: false,
      piTranscriptPresent: true,
    })
    expect(out.reasons.some((r) => r.includes("has NOT ended"))).toBe(false)
  })

  // The same live-pid fact under a claude "done" is unremarkable — the
  // supervisor wrote that state itself.
  test("never claims it for a claude session", () => {
    const out = explainSession({
      session: makeSession({ state: "done" }),
      now: NOW,
      updatedAtMs: NOW - 1_000,
      lastEventAtMs: undefined,
      pidAlive: true,
      stateFilePresent: true,
    })
    expect(out.reasons.some((r) => r.includes("has NOT ended"))).toBe(false)
  })

  // A dead pi pid is the end of the run: nothing respawns it, so the claude
  // wording ("the supervisor respawns it on the next attach or peek") would be
  // an outright false promise here.
  test("does not promise a respawn for a dead pi pid", () => {
    const out = explainSession({
      session: makeSession({ state: "failed", source: "pi-spawn-log" }),
      now: NOW,
      updatedAtMs: NOW - 1_000,
      lastEventAtMs: undefined,
      pidAlive: false,
      stateFilePresent: false,
      piTranscriptPresent: true,
    })
    const reason = out.reasons.find((r) => r.includes("no longer alive"))
    expect(reason).toBeDefined()
    // The claude promise — that something picks the worker back up — must not
    // be made for a pi run, in either direction of phrasing.
    expect(reason).not.toContain("the supervisor respawns it")
    expect(reason).toContain("nothing will respawn it")
    expect(reason).toContain("no supervisor")
  })

  // For a claude session state.json is an independent report by the session
  // itself; for pi there is no such report, so an unclassified pane leaves the
  // whole explanation resting on the daemon's own inference.
  test("says an unclassified pane leaves a pi state with no independent evidence", () => {
    const out = explainSession({
      session: makeSession({ state: "done", source: "pi-spawn-log" }),
      now: NOW,
      updatedAtMs: NOW - 1_000,
      lastEventAtMs: undefined,
      pidAlive: false,
      stateFilePresent: false,
      piTranscriptPresent: true,
      terminal: undefined,
    })
    expect(out.reasons.some((r) => r.includes("no independent observation"))).toBe(true)
  })

  // Found by running this endpoint against a real dispatched pi run: the poller
  // HAD classified the pane, as `unknown` — no matcher fired. A record that
  // asserts nothing corroborates nothing, so the reason must still fire.
  test("still says so when the pane was classified but no matcher fired", () => {
    const out = explainSession({
      session: makeSession({ state: "done", source: "pi-spawn-log" }),
      now: NOW,
      updatedAtMs: NOW - 1_000,
      lastEventAtMs: undefined,
      pidAlive: true,
      stateFilePresent: false,
      piTranscriptPresent: true,
      terminal: { state: "unknown", matcher: undefined, evidence: undefined, atMs: NOW - 100 },
    })
    const reason = out.reasons.find((r) => r.includes("no independent observation"))
    expect(reason).toBeDefined()
    // ...and it names what the screen actually said, rather than claiming
    // nothing was looked at.
    expect(reason).toContain('classified "unknown"')
  })

  test("stays quiet about independent evidence once the pane has been classified", () => {
    const out = explainSession({
      session: makeSession({ state: "done", source: "pi-spawn-log" }),
      now: NOW,
      updatedAtMs: NOW - 1_000,
      lastEventAtMs: undefined,
      pidAlive: false,
      stateFilePresent: false,
      piTranscriptPresent: true,
      terminal: { state: "idle", matcher: "prompt-resting", evidence: "❯", atMs: NOW - 100 },
    })
    expect(out.reasons.some((r) => r.includes("no independent observation"))).toBe(false)
  })

  // A claude session's unclassified pane is NOT evidence-free — state.json is
  // the session's own report — so this reason must never fire for one.
  test("never claims a claude session has no independent evidence", () => {
    const out = explainSession({
      session: makeSession({ state: "working" }),
      now: NOW,
      updatedAtMs: NOW - 1_000,
      lastEventAtMs: undefined,
      pidAlive: true,
      stateFilePresent: true,
      terminal: undefined,
    })
    expect(out.reasons.some((r) => r.includes("no independent observation"))).toBe(false)
  })

  test("reports a run pi has written no transcript for as resting on the pid alone", () => {
    const out = explainSession({
      session: makeSession({ state: "working", source: "pi-spawn-log" }),
      now: NOW,
      updatedAtMs: NOW - 1_000,
      lastEventAtMs: undefined,
      pidAlive: true,
      stateFilePresent: false,
      piTranscriptPresent: false,
    })
    const reason = out.reasons.find((r) => r.includes("no transcript"))
    expect(reason).toBeDefined()
    expect(reason).toContain("pid probe alone")
  })

  test("says nothing about a missing transcript once pi has written one", () => {
    const out = explainSession({
      session: makeSession({ state: "working", source: "pi-spawn-log" }),
      now: NOW,
      updatedAtMs: NOW - 1_000,
      lastEventAtMs: undefined,
      pidAlive: true,
      stateFilePresent: false,
      piTranscriptPresent: true,
    })
    expect(out.reasons.some((r) => r.includes("no transcript"))).toBe(false)
  })

  // `stale` is still computed for pi — the transcript mtime is real evidence
  // of when pi last did something — but the sentence must name the transcript,
  // because the state.json it would otherwise cite never existed.
  test("blames the transcript, not state.json, for a stale pi run", () => {
    const out = explainSession({
      session: makeSession({ state: "working", source: "pi-spawn-log" }),
      now: NOW,
      updatedAtMs: NOW - (STALE_ACTIVE_MS + 1),
      lastEventAtMs: undefined,
      pidAlive: true,
      stateFilePresent: false,
      piTranscriptPresent: true,
    })
    expect(out.stale).toBe(true)
    const reason = out.reasons.find((r) => r.toLowerCase().includes("stale"))
    expect(reason).toContain("transcript")
    expect(reason).not.toContain("state.json")
  })

  // With no transcript, `updatedAt` is the spawn time — so the stale sentence
  // must not claim pi touched anything at all.
  test("blames the spawn record when a stale pi run has no transcript", () => {
    const out = explainSession({
      session: makeSession({ state: "working", source: "pi-spawn-log" }),
      now: NOW,
      updatedAtMs: NOW - (STALE_ACTIVE_MS + 1),
      lastEventAtMs: undefined,
      pidAlive: true,
      stateFilePresent: false,
      piTranscriptPresent: false,
    })
    const reason = out.reasons.find((r) => r.toLowerCase().includes("stale"))
    expect(reason).toContain("spawn record")
    expect(reason).not.toContain("state.json")
  })

  // The same missing-file fact for a claude session (state.json / roster-seed
  // provenance) is still reported — only pi-spawn-log suppresses it.
  test("still reports the missing file for a claude session (contrast case)", () => {
    const out = explainSession({
      session: makeSession({ state: "done", source: "state.json" }),
      now: NOW,
      updatedAtMs: NOW - 1_000,
      lastEventAtMs: undefined,
      pidAlive: undefined,
      stateFilePresent: false,
    })
    expect(out.reasons.some((r) => r.includes("no longer on disk"))).toBe(true)
  })
})

describe("explainSession — degraded slug", () => {
  test("names the raw unrecognized slug", () => {
    const out = explainSession({
      session: makeSession({ state: "unknown", degradedFrom: "supervisor-v3-migrating" }),
      now: NOW,
      updatedAtMs: NOW - 1_000,
      lastEventAtMs: undefined,
      pidAlive: true,
      stateFilePresent: true,
    })
    expect(out.degradedFrom).toBe("supervisor-v3-migrating")
    expect(out.reasons.some((r) => r.includes("supervisor-v3-migrating"))).toBe(true)
    expect(out.reasons.some((r) => r.includes("unknown"))).toBe(true)
  })
})

describe("explainSession — missing state.json", () => {
  test("reports state.json is gone from disk", () => {
    const out = explainSession({
      session: makeSession({ state: "done" }),
      now: NOW,
      updatedAtMs: NOW - 1_000,
      lastEventAtMs: undefined,
      pidAlive: undefined,
      stateFilePresent: false,
    })
    expect(out.stateFilePresent).toBe(false)
    expect(out.reasons.some((r) => r.includes("no longer on disk"))).toBe(true)
  })
})

describe("explainSession — dead pid", () => {
  test("mentions the supervisor respawns on attach/peek", () => {
    const out = explainSession({
      session: makeSession({ state: "working" }),
      now: NOW,
      updatedAtMs: NOW - 1_000,
      lastEventAtMs: undefined,
      pidAlive: false,
      stateFilePresent: true,
    })
    expect(out.reasons.some((r) => r.includes("respawn"))).toBe(true)
  })

  test("says nothing about the pid when it is undefined (no pid known)", () => {
    const out = explainSession({
      session: makeSession({ state: "working" }),
      now: NOW,
      updatedAtMs: NOW - 1_000,
      lastEventAtMs: undefined,
      pidAlive: undefined,
      stateFilePresent: true,
    })
    expect(out.reasons.some((r) => r.includes("pid"))).toBe(false)
  })
})

describe("explainSession — staleness boundary", () => {
  test("is not stale at exactly the threshold", () => {
    const out = explainSession({
      session: makeSession({ state: "working" }),
      now: NOW,
      updatedAtMs: NOW - STALE_ACTIVE_MS,
      lastEventAtMs: undefined,
      pidAlive: true,
      stateFilePresent: true,
    })
    expect(out.updatedAtAgeMs).toBe(STALE_ACTIVE_MS)
    expect(out.stale).toBe(false)
    expect(out.reasons.some((r) => r.toLowerCase().includes("stale"))).toBe(false)
  })

  test("is stale one millisecond past the threshold", () => {
    const out = explainSession({
      session: makeSession({ state: "working" }),
      now: NOW,
      updatedAtMs: NOW - (STALE_ACTIVE_MS + 1),
      lastEventAtMs: undefined,
      pidAlive: true,
      stateFilePresent: true,
    })
    expect(out.updatedAtAgeMs).toBe(STALE_ACTIVE_MS + 1)
    expect(out.stale).toBe(true)
    const staleReason = out.reasons.find((r) => r.toLowerCase().includes("stale"))
    expect(staleReason).toBeDefined()
    expect(staleReason).toContain(String(STALE_ACTIVE_MS + 1))
    expect(staleReason).toContain("working")
    // The evidence a claude session's staleness is measured against, named
    // explicitly — pi's is its transcript, and the two must not be confused.
    expect(staleReason).toContain("state.json")
  })

  test.each([
    "blocked",
    "needs_input",
  ] as const)("'%s' is also an active state that can go stale", (state) => {
    const out = explainSession({
      session: makeSession({ state }),
      now: NOW,
      updatedAtMs: NOW - (STALE_ACTIVE_MS + 1),
      lastEventAtMs: undefined,
      pidAlive: true,
      stateFilePresent: true,
    })
    expect(out.stale).toBe(true)
  })

  test.each([
    "done",
    "idle",
    "stopped",
    "failed",
  ] as const)("a finished '%s' session sitting untouched for a long time is not stale", (state) => {
    const out = explainSession({
      session: makeSession({ state }),
      now: NOW,
      updatedAtMs: NOW - 1000 * 60 * 60 * 24, // a day
      lastEventAtMs: undefined,
      pidAlive: undefined,
      stateFilePresent: true,
    })
    expect(out.stale).toBe(false)
    expect(out.reasons.some((r) => r.toLowerCase().includes("stale"))).toBe(false)
  })

  test("is not stale when updatedAtMs is unavailable, even for an active state", () => {
    const out = explainSession({
      session: makeSession({ state: "working" }),
      now: NOW,
      updatedAtMs: undefined,
      lastEventAtMs: undefined,
      pidAlive: true,
      stateFilePresent: true,
    })
    expect(out.updatedAtAgeMs).toBeUndefined()
    expect(out.stale).toBe(false)
  })
})

describe("explainSession — ages", () => {
  test("clamps a negative age (clock skew / future timestamp) to zero", () => {
    const out = explainSession({
      session: makeSession({ state: "working" }),
      now: NOW,
      updatedAtMs: NOW + 5_000,
      lastEventAtMs: NOW + 5_000,
      pidAlive: true,
      stateFilePresent: true,
    })
    expect(out.updatedAtAgeMs).toBe(0)
    expect(out.lastEventAgeMs).toBe(0)
  })

  test("is undefined when the shell could not parse the instant (NaN)", () => {
    const out = explainSession({
      session: makeSession({ state: "working" }),
      now: NOW,
      updatedAtMs: Date.parse("not-a-date"),
      lastEventAtMs: Date.parse("not-a-date"),
      pidAlive: true,
      stateFilePresent: true,
    })
    expect(out.updatedAtAgeMs).toBeUndefined()
    expect(out.lastEventAgeMs).toBeUndefined()
  })
})

// The whole reason explain grew a screen section. `state.json` and the
// classified pane are two independent readings, and when they disagree the
// disagreement IS the answer — session 4d76edc1 read `working` in state.json
// for 24 hours while its pane sat at an empty prompt.
describe("explainSession — screen facts", () => {
  const withScreen = ({
    state,
    screen,
    atMs = NOW - 30_000,
  }: {
    state: SessionStateSlug
    screen: string
    atMs?: number | undefined
  }) =>
    explainSession({
      session: makeSession({ state }),
      now: NOW,
      updatedAtMs: NOW - 1_000,
      lastEventAtMs: undefined,
      pidAlive: true,
      stateFilePresent: true,
      terminal: {
        state: screen,
        matcher: "prompt-resting",
        evidence: "❯",
        atMs,
      },
    })

  test("echoes the polled screen facts, with the observation's age", () => {
    const out = withScreen({ state: "working", screen: "idle" })
    expect(out.terminal).toEqual({
      state: "idle",
      matcher: "prompt-resting",
      evidence: "❯",
      ageMs: 30_000,
    })
  })

  test("omits the screen section entirely when nothing has classified the pane", () => {
    const out = explainSession({
      session: makeSession({ state: "working" }),
      now: NOW,
      updatedAtMs: NOW - 1_000,
      lastEventAtMs: undefined,
      pidAlive: true,
      stateFilePresent: true,
    })
    expect(out.terminal).toBeUndefined()
    expect(out.screenDisagrees).toBe(false)
    expect(out.reasons.some((r) => r.toLowerCase().includes("screen"))).toBe(false)
  })

  test("clamps a future screen timestamp to a zero age, and drops an unparseable one", () => {
    expect(
      withScreen({ state: "working", screen: "idle", atMs: NOW + 5_000 }).terminal?.ageMs,
    ).toBe(0)
    expect(
      withScreen({ state: "working", screen: "idle", atMs: Date.parse("nope") }).terminal?.ageMs,
    ).toBeUndefined()
  })

  // The 4d76edc1 case exactly.
  test("reports the contradiction when a working session's pane is resting", () => {
    const out = withScreen({ state: "working", screen: "idle" })
    expect(out.screenDisagrees).toBe(true)
    const reason = out.reasons.find((r) => r.toLowerCase().includes("screen"))
    expect(reason).toBeDefined()
    expect(reason).toContain("working")
    expect(reason).toContain("idle")
    // The matcher and the matched line are what let a human check the claim.
    expect(reason).toContain("prompt-resting")
    expect(reason).toContain("❯")
  })

  test("reports the contradiction when a blocked session's pane is still generating", () => {
    const out = withScreen({ state: "blocked", screen: "working" })
    expect(out.screenDisagrees).toBe(true)
    expect(out.reasons.some((r) => r.toLowerCase().includes("screen"))).toBe(true)
  })

  // Tuned against the live daemon (see apps/web/src/features/terminal/
  // terminalState.ts): a resting pane agrees with EVERY not-running supervisor
  // state. A finished session naturally sits at its prompt, so calling that a
  // conflict put a warning on 13 of 21 sessions saying "IDLE" beside "DONE".
  test.each([
    "idle",
    "done",
    "stopped",
    "failed",
  ] as const)("a resting screen confirms rather than contradicts a '%s' session", (state) => {
    const out = withScreen({ state, screen: "idle" })
    expect(out.screenDisagrees).toBe(false)
    expect(out.reasons.some((r) => r.toLowerCase().includes("screen"))).toBe(false)
  })

  // Two names for one condition across supervisor versions.
  test.each([
    "blocked",
    "needs_input",
  ] as const)("a blocked screen agrees with a '%s' session", (state) => {
    expect(withScreen({ state, screen: "blocked" }).screenDisagrees).toBe(false)
  })

  test("a working screen agrees with a working session", () => {
    expect(withScreen({ state: "working", screen: "working" }).screenDisagrees).toBe(false)
  })

  // No matcher firing is the absence of evidence, not evidence of anything —
  // it can never be grounds for calling the supervisor wrong.
  test.each([
    "working",
    "blocked",
    "needs_input",
    "done",
    "idle",
    "failed",
    "stopped",
  ] as const)("an unknown screen is never a disagreement, whatever the session claims ('%s')", (state) => {
    const out = withScreen({ state, screen: "unknown" })
    expect(out.screenDisagrees).toBe(false)
    expect(out.reasons.some((r) => r.toLowerCase().includes("screen"))).toBe(false)
    // The facts are still echoed — a caller may want the age even when the
    // classification says nothing.
    expect(out.terminal?.state).toBe("unknown")
  })

  test("a screen state this daemon does not recognize is not a disagreement either", () => {
    expect(withScreen({ state: "working", screen: "compiling" }).screenDisagrees).toBe(false)
  })

  test("reads a contradiction without a matcher or evidence without breaking the sentence", () => {
    const out = explainSession({
      session: makeSession({ state: "working" }),
      now: NOW,
      updatedAtMs: NOW - 1_000,
      lastEventAtMs: undefined,
      pidAlive: true,
      stateFilePresent: true,
      terminal: { state: "idle", matcher: undefined, evidence: undefined, atMs: undefined },
    })
    expect(out.screenDisagrees).toBe(true)
    const reason = out.reasons.find((r) => r.toLowerCase().includes("screen"))
    expect(reason).toContain("idle")
    expect(reason).not.toContain("undefined")
  })

  // The screen reason is additive: it must not displace the provenance line or
  // the staleness line a caller already relies on.
  test("stacks with the staleness reason rather than replacing it", () => {
    const out = explainSession({
      session: makeSession({ state: "working" }),
      now: NOW,
      updatedAtMs: NOW - (STALE_ACTIVE_MS + 1),
      lastEventAtMs: undefined,
      pidAlive: true,
      stateFilePresent: true,
      terminal: { state: "idle", matcher: "prompt-resting", evidence: "❯", atMs: NOW - 1_000 },
    })
    expect(out.reasons.some((r) => r.includes("state.json, the session's own status file"))).toBe(
      true,
    )
    expect(out.reasons.some((r) => r.toLowerCase().includes("stale"))).toBe(true)
    expect(out.reasons.some((r) => r.toLowerCase().includes("screen"))).toBe(true)
  })
})

describe("explainSession — passthrough fields", () => {
  test("echoes short and state verbatim", () => {
    const out = explainSession({
      session: makeSession({ short: "zz99", state: "failed" }),
      now: NOW,
      updatedAtMs: undefined,
      lastEventAtMs: undefined,
      pidAlive: undefined,
      stateFilePresent: true,
    })
    expect(out.short).toBe("zz99")
    expect(out.state).toBe("failed")
  })
})
