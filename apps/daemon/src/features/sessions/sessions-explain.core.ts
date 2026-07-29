import { STALE_ACTIVE_MS } from "@pid/shared"
// Pure state-provenance decision logic for GET /:id/explain. No I/O — the pid
// probe, disk existence check and clock all live in sessions.io.ts; this file
// only turns already-resolved facts into a human-readable explanation.

import { ageMs, type SessionState, type SessionStateSlug } from "./sessions.core"

// The screen-derived reading of the same session, as plain input fields. The
// terminal slice owns the classification (features/terminal/
// terminal-state.core.ts); the route reads it through an injected port and
// hands the values here, so this file neither imports that slice nor knows its
// `TerminalStateSlug` type — `state` is a bare string on purpose, and an
// unrecognized value is handled the same way `unknown` is.
export type ScreenFacts = {
  readonly state: string
  readonly matcher: string | undefined
  readonly evidence: string | undefined
  // The record's two timestamps, `Date.parse`d by the shell (this file reads no
  // clock and no date format). They mean different things and both are reported:
  // `screenReadAtMs` is when the pane was last actually read — the freshness of
  // the evidence — and `stateChangedAtMs` is when this classification last
  // changed. See TerminalStateRecord in features/terminal/terminal.routes.ts.
  readonly screenReadAtMs: number | undefined
  readonly stateChangedAtMs: number | undefined
}

// The two facts above turned into durations against `now`, computed once and
// passed around together so no helper can take one for the other:
//   - `readAgeMs`      — how long ago the pane was last read (evidence freshness)
//   - `unchangedForMs` — how long it has been reading this way (dwell)
type ScreenAges = {
  readonly readAgeMs: number | undefined
  readonly unchangedForMs: number | undefined
}

export type ExplainInput = {
  readonly session: SessionState
  readonly now: number // epoch ms, resolved by the shell
  readonly updatedAtMs: number | undefined // Date.parse of session.updatedAt, by the shell
  readonly lastEventAtMs: number | undefined // last time the daemon published for this short
  readonly pidAlive: boolean | undefined // undefined = no pid known
  readonly stateFilePresent: boolean
  // Absent when the poller has never classified this session's pane — the
  // supervisor-only explanation every caller got before this field existed.
  readonly terminal?: ScreenFacts | undefined
  // pi only: whether pi has written its transcript for this run yet. pi keeps no
  // per-session status file, so the transcript is the only artifact pi itself
  // produces — a pi `state` is the daemon reading its tail plus probing the pid
  // it recorded at spawn. Absent (`undefined`) for a claude session, where
  // `stateFilePresent` already reports the file the state came from.
  readonly piTranscriptPresent?: boolean | undefined
}

export type Explanation = {
  readonly short: string
  readonly state: SessionStateSlug
  readonly source: "state.json" | "roster-seed" | "pi-spawn-log"
  readonly degradedFrom: string | undefined
  readonly updatedAtAgeMs: number | undefined
  readonly lastEventAgeMs: number | undefined
  readonly pidAlive: boolean | undefined
  readonly stateFilePresent: boolean
  readonly stale: boolean
  // What the pane itself last showed, with BOTH of its ages — `undefined` when
  // nothing has classified it.
  //
  // `readAgeMs` is how long ago the pane was last read, i.e. how fresh this
  // evidence is; `unchangedForMs` is how long it has been reading this way. The
  // single `ageMs` these replaced carried the change time under a name every
  // reader printed as "observed <age> ago", which understated the reading's own
  // freshness by hours on a pane resting all morning.
  readonly terminal:
    | {
        readonly state: string
        readonly matcher: string | undefined
        readonly evidence: string | undefined
        readonly readAgeMs: number | undefined
        readonly unchangedForMs: number | undefined
      }
    | undefined
  // Whether that reading actually contradicts `state` — the machine-readable
  // form of the reason sentence below. `false` when they agree, when the
  // classification says nothing, and when there is no classification at all.
  readonly screenDisagrees: boolean
  readonly reasons: ReadonlyArray<string>
}

// A session only claims to be actively worked on in these three slugs — a
// `done`/`idle`/`stopped`/`failed` session sitting untouched for a day is
// finished, not stale.
const ACTIVE_STATES: ReadonlySet<SessionStateSlug> = new Set(["working", "blocked", "needs_input"])

const isActiveState = (state: SessionStateSlug): boolean => ACTIVE_STATES.has(state)

const computeStale = ({
  state,
  updatedAtAgeMs,
}: {
  readonly state: SessionStateSlug
  readonly updatedAtAgeMs: number | undefined
}): boolean => {
  if (!isActiveState(state)) return false
  if (updatedAtAgeMs === undefined) return false
  return updatedAtAgeMs > STALE_ACTIVE_MS
}

// --- Reason predicates --------------------------------------------------
//
// Each helper answers one question and returns a sentence only when its
// observation actually applies, or `undefined` for "nothing to say" — kept
// small and branch-free (a ternary each) so `bun run audit`'s cyclomatic
// complexity ceiling never sees a long if/else chain.

// A table, not a branch chain: adding a fourth source later means one new
// entry here, not a longer if/else for `bun run audit`'s complexity ceiling
// to flag.
const SOURCE_REASON: Record<SessionState["source"], string> = {
  "state.json": "State came from state.json, the session's own status file.",
  "roster-seed":
    "State came from the roster seed, not state.json — the supervisor listed this worker but its state.json hasn't been parsed yet, so intent/cwd/sessionId are roster-derived and everything else is unknown.",
  "pi-spawn-log":
    "State came from the daemon's own pi spawn log, not a supervisor state.json: pi writes no per-session status file, so this state is not a report pi made — it is the daemon's inference from the two things it can see, the tail of pi's transcript and a probe of the pid it recorded at spawn.",
}

const sourceReason = (session: Pick<SessionState, "source">): string =>
  SOURCE_REASON[session.source]

// --- What a pi explanation cannot claim ---------------------------------
//
// Everything below fires only for `pi-spawn-log` provenance, and every sentence
// exists because the claude-shaped answer would be wrong rather than merely
// incomplete. Kept as predicates in the same style as the ones above so
// `buildReasons` stays one array literal.

const isPi = (source: SessionState["source"]): boolean => source === "pi-spawn-log"

// `derivePiState` (features/dispatch/pi-sessions.core.ts) can only ever return
// done / working / failed. The two slugs it cannot reach are precisely the ones
// a caller polls for when a run looks stuck, so their absence has to be stated:
// silence would read as "pi is definitely not waiting on you".
const PI_UNREACHABLE_STATES_REASON =
  'pi never reports that it is waiting on you, so "blocked" and "needs_input" are states this daemon cannot derive for a pi run at all — a pi session sitting at a permission prompt still reads "working" or "done" here. Only the screen classification can show one waiting.'

const piUnreachableStatesReason = (source: SessionState["source"]): string | undefined =>
  isPi(source) ? PI_UNREACHABLE_STATES_REASON : undefined

// Both halves of this were observed live against dispatched pi runs, and the
// second is why the sentence does not simply say "resting at its prompt":
//
//   1. pi finishes a turn, writes an assistant message as the transcript's last
//      entry, and keeps running at its prompt — "done" with a live process.
//   2. pi is MID-TURN with a tool call in flight. The assistant's tool-use
//      message is already the transcript's last entry (the tool result arrives
//      as the next, user-role, entry), so a busy pi reads "done" too — caught
//      on the second poll of a four-tool-call run, screen reading "working".
//
// So a live pid under "done" means the run has not ended, and nothing narrower
// than that is safe to claim.
const piDoneButAliveReason = ({
  source,
  state,
  pidAlive,
}: {
  readonly source: SessionState["source"]
  readonly state: SessionStateSlug
  readonly pidAlive: boolean | undefined
}): string | undefined => {
  if (!isPi(source) || state !== "done" || pidAlive !== true) return undefined
  return "The \"done\" above is the shape of pi's transcript, not an exit: its last entry is an assistant message. The pi process is still alive, so this run has NOT ended — it is either resting at pi's prompt after a finished turn, or still mid-turn with a tool call in flight, which also leaves an assistant message last until the result comes back. The screen tells these apart; the transcript cannot."
}

// For a claude session an unclassified pane costs nothing: state.json is the
// session's own independent report. A pi state has no such second source, so
// without a screen reading the whole explanation is one observer talking to
// itself, and that is worth saying out loud.
//
// "Without a screen reading" is NOT the same as "without a screen record":
// observed live against a dispatched pi run resting at its prompt, the poller
// had classified the pane as `unknown` — a record present, no matcher fired,
// asserting nothing (see SCREEN_AGREES_WITH). Keying this off the record's mere
// existence would have quietly claimed corroboration that did not exist, which
// is the exact failure this endpoint is supposed to catch.
const piNoCorroborationReason = ({
  source,
  terminal,
}: {
  readonly source: SessionState["source"]
  readonly terminal: ScreenFacts | undefined
}): string | undefined => {
  if (!isPi(source) || screenAssertion(terminal) !== undefined) return undefined
  const observed =
    terminal === undefined
      ? "Nothing has classified this pane"
      : `The pane was classified "${terminal.state}", which asserts nothing about the session`
  return `${observed}, so no independent observation backs this state: every field above comes from the daemon's own spawn log, transcript read and pid probe.`
}

// No transcript yet means the tail-read half of the inference had nothing to
// read, and `updatedAt` fell back to the spawn instant — so the age reported
// above is the age of the launch, not of any pi activity.
const piNoTranscriptReason = ({
  source,
  piTranscriptPresent,
}: {
  readonly source: SessionState["source"]
  readonly piTranscriptPresent: boolean | undefined
}): string | undefined =>
  isPi(source) && piTranscriptPresent === false
    ? "pi has written no transcript for this run yet, so this state rests on the pid probe alone, and the updated age above is the age of the spawn rather than of anything pi did."
    : undefined

const degradedReason = (degradedFrom: string | undefined): string | undefined =>
  degradedFrom === undefined
    ? undefined
    : `The raw state "${degradedFrom}" is not a recognized slug — surfaced as "unknown" instead of silently degrading to "idle".`

// A pi session never had a state.json to lose — its absence isn't a gone
// file, it's the harness. Only claude sessions (state.json / roster-seed
// provenance) treat a missing file as something to report.
const missingStateFileReason = ({
  source,
  stateFilePresent,
}: {
  readonly source: SessionState["source"]
  readonly stateFilePresent: boolean
}): string | undefined => {
  if (stateFilePresent) return undefined
  if (source === "pi-spawn-log") return undefined
  return "state.json is no longer on disk."
}

// A dead claude worker gets picked back up; a dead pi process does not — there
// is nothing in pi's world that would respawn it. One table so the promise is
// made only where it can be kept.
const DEAD_PID_REASON: Record<SessionState["source"], string> = {
  "state.json":
    "The worker pid is no longer alive; the supervisor respawns it on the next attach or peek.",
  "roster-seed":
    "The worker pid is no longer alive; the supervisor respawns it on the next attach or peek.",
  "pi-spawn-log":
    "The pi process is no longer alive, and nothing will respawn it — pi has no supervisor. This run is over; the state above is the daemon's reading of how it ended, from the transcript pi left behind.",
}

const deadPidReason = ({
  source,
  pidAlive,
}: {
  readonly source: SessionState["source"]
  readonly pidAlive: boolean | undefined
}): string | undefined => (pidAlive === false ? DEAD_PID_REASON[source] : undefined)

// --- Screen agreement ----------------------------------------------------
//
// Which supervisor slugs each screen classification is really asserting the
// same thing as. Mirrored from apps/web/src/features/terminal/terminalState.ts
// (guarded by scripts/mirrored-constants.test.ts) because it was tuned there
// against the live daemon, and the chip and this endpoint must not drift on
// what "the screen disagrees" means.
//
// The two entries worth defending:
//   - `blocked` covers `needs_input`: one condition, two spellings across
//     supervisor versions.
//   - `idle` covers every not-running state, not just `idle`. A finished
//     session naturally sits at its prompt, so pairing `done` with a resting
//     pane is confirmation, not news — measured live, treating it as a
//     conflict flagged 13 of 21 sessions for saying "idle" beside "done".
// An EMPTY row — `unknown` — asserts nothing, and so can never disagree with
// anything: no matcher firing is the absence of evidence, not evidence against
// the supervisor. A screen state missing from the table entirely (one a future
// classifier adds before this table learns about it) is treated the same way.
export const SCREEN_AGREES_WITH: Readonly<Record<string, ReadonlyArray<string>>> = {
  working: ["working"],
  blocked: ["blocked", "needs_input"],
  idle: ["idle", "done", "stopped", "failed"],
  unknown: [],
}

// The slugs the screen is actually asserting, or `undefined` when it asserts
// nothing at all — no record, an empty row (`unknown`), or a state this table
// predates. One definition, because "the screen said something" is a question
// two reasons ask: whether it contradicts `state`, and (for pi) whether
// anything independent backs `state` in the first place.
const screenAssertion = (terminal: ScreenFacts | undefined): ReadonlyArray<string> | undefined => {
  const agrees = terminal === undefined ? undefined : SCREEN_AGREES_WITH[terminal.state]
  return agrees === undefined || agrees.length === 0 ? undefined : agrees
}

const computeScreenDisagrees = ({
  state,
  terminal,
}: {
  readonly state: SessionStateSlug
  readonly terminal: ScreenFacts | undefined
}): boolean => {
  const agrees = screenAssertion(terminal)
  return agrees === undefined ? false : !agrees.includes(state)
}

// The two ages, spelled so neither can be mistaken for the other. "read" is the
// freshness of the evidence; "unchanged for" is dwell. The sentence used to carry
// one number as "observed <age> ago" and that number was the dwell — so a reading
// taken seconds ago read as two hours stale, in the field a reader leans on
// hardest when deciding whether to believe the rest.
const screenAgeParts = ({
  readAgeMs,
  unchangedForMs,
}: {
  readonly readAgeMs: number | undefined
  readonly unchangedForMs: number | undefined
}): ReadonlyArray<string | undefined> => [
  readAgeMs === undefined ? undefined : `read ${readAgeMs}ms ago`,
  unchangedForMs === undefined ? undefined : `unchanged for ${unchangedForMs}ms`,
]

// The parenthetical that lets a human check the claim instead of taking it:
// which matcher fired, the exact line it matched, and both ages of the reading.
// Each part is dropped rather than printed as "undefined" when absent.
const screenProvenance = ({
  terminal,
  ages,
}: {
  readonly terminal: ScreenFacts
  readonly ages: ScreenAges
}): string => {
  const parts = [
    terminal.matcher === undefined ? undefined : `matcher "${terminal.matcher}"`,
    terminal.evidence === undefined ? undefined : `matched "${terminal.evidence}"`,
    ...screenAgeParts(ages),
  ].filter((part): part is string => part !== undefined)
  return parts.length === 0 ? "" : ` (${parts.join(", ")})`
}

// The single most useful sentence this endpoint can produce: the supervisor and
// the pane are describing the same session and they do not match.
const screenConflictReason = ({
  disagrees,
  state,
  terminal,
  ages,
}: {
  readonly disagrees: boolean
  readonly state: SessionStateSlug
  readonly terminal: ScreenFacts | undefined
  readonly ages: ScreenAges
}): string | undefined => {
  if (!disagrees || terminal === undefined) return undefined
  return `The screen disagrees: state claims "${state}", but the classified terminal reads "${terminal.state}"${screenProvenance({ terminal, ages })}. The screen is a direct reading of the pane rather than something the agent reported, so treat "${state}" as unconfirmed.`
}

// What the staleness clock is actually reading. A claude session writes
// state.json; pi writes only its transcript, and before pi has written even
// that, `updatedAt` is the spawn instant. Naming the wrong file here is the
// difference between a diagnosis and a fabrication.
const staleEvidence = ({
  source,
  piTranscriptPresent,
}: {
  readonly source: SessionState["source"]
  readonly piTranscriptPresent: boolean | undefined
}): string => {
  if (!isPi(source)) return "state.json"
  return piTranscriptPresent === false
    ? "the spawn record (pi has written no transcript at all)"
    : "pi's transcript"
}

const staleReason = ({
  stale,
  state,
  updatedAtAgeMs,
  evidence,
}: {
  readonly stale: boolean
  readonly state: SessionStateSlug
  readonly updatedAtAgeMs: number | undefined
  readonly evidence: string
}): string | undefined =>
  stale
    ? `Stale: state claims "${state}" but ${evidence} has not been updated in ${updatedAtAgeMs}ms, past the ${STALE_ACTIVE_MS}ms active-session threshold.`
    : undefined

const buildReasons = ({
  session,
  stateFilePresent,
  pidAlive,
  stale,
  updatedAtAgeMs,
  piTranscriptPresent,
  screen,
}: {
  readonly session: SessionState
  readonly stateFilePresent: boolean
  readonly pidAlive: boolean | undefined
  readonly stale: boolean
  readonly updatedAtAgeMs: number | undefined
  readonly piTranscriptPresent: boolean | undefined
  readonly screen: {
    readonly disagrees: boolean
    readonly terminal: ScreenFacts | undefined
    readonly ages: ScreenAges
  }
}): ReadonlyArray<string> => {
  const source = session.source
  const conditional = [
    // The pi limits come first among the conditionals: they qualify every fact
    // that follows, so a reader hitting the dead-pid or stale line below
    // already knows what kind of evidence produced it.
    piUnreachableStatesReason(source),
    piNoTranscriptReason({ source, piTranscriptPresent }),
    piDoneButAliveReason({ source, state: session.state, pidAlive }),
    degradedReason(session.degradedFrom),
    missingStateFileReason({ source, stateFilePresent }),
    deadPidReason({ source, pidAlive }),
    staleReason({
      stale,
      state: session.state,
      updatedAtAgeMs,
      evidence: staleEvidence({ source, piTranscriptPresent }),
    }),
    screenConflictReason({
      disagrees: screen.disagrees,
      state: session.state,
      terminal: screen.terminal,
      ages: screen.ages,
    }),
    piNoCorroborationReason({ source, terminal: screen.terminal }),
  ]
  return [sourceReason(session), ...conditional.filter((r): r is string => r !== undefined)]
}

export const explainSession = ({
  session,
  now,
  updatedAtMs,
  lastEventAtMs,
  pidAlive,
  stateFilePresent,
  terminal,
  piTranscriptPresent,
}: ExplainInput): Explanation => {
  const updatedAtAgeMs = ageMs({ now, createdAtMs: updatedAtMs })
  const lastEventAgeMs = ageMs({ now, createdAtMs: lastEventAtMs })
  const stale = computeStale({ state: session.state, updatedAtAgeMs })
  // Both ages, from the record's two stamps. Neither is derivable from the other:
  // a pane read 7s ago may have been reading the same way for two hours.
  const ages: ScreenAges = {
    readAgeMs: ageMs({ now, createdAtMs: terminal?.screenReadAtMs }),
    unchangedForMs: ageMs({ now, createdAtMs: terminal?.stateChangedAtMs }),
  }
  const screenDisagrees = computeScreenDisagrees({ state: session.state, terminal })
  return {
    short: session.short,
    state: session.state,
    source: session.source,
    degradedFrom: session.degradedFrom,
    updatedAtAgeMs,
    lastEventAgeMs,
    pidAlive,
    stateFilePresent,
    stale,
    terminal:
      terminal === undefined
        ? undefined
        : {
            state: terminal.state,
            matcher: terminal.matcher,
            evidence: terminal.evidence,
            ...ages,
          },
    screenDisagrees,
    reasons: buildReasons({
      session,
      stateFilePresent,
      pidAlive,
      stale,
      updatedAtAgeMs,
      piTranscriptPresent,
      screen: { disagrees: screenDisagrees, terminal, ages },
    }),
  }
}
