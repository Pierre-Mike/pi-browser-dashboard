// Pure state-provenance decision logic for GET /:id/explain. No I/O — the pid
// probe, disk existence check and clock all live in sessions.io.ts; this file
// only turns already-resolved facts into a human-readable explanation.

import { ageMs, type SessionState, type SessionStateSlug } from "./sessions.core"

export const STALE_ACTIVE_MS = 120_000

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
  readonly atMs: number | undefined // Date.parse of the record's `at`, by the shell
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
  // What the pane itself last showed, and how long ago it was observed.
  // `undefined` when nothing has classified it.
  readonly terminal:
    | {
        readonly state: string
        readonly matcher: string | undefined
        readonly evidence: string | undefined
        readonly ageMs: number | undefined
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
    "State came from the daemon's pi spawn log, not a supervisor state.json — pi has no per-session status file, so the staleness and pid-liveness facts below don't carry the same meaning they do for a claude session.",
}

const sourceReason = (session: Pick<SessionState, "source">): string =>
  SOURCE_REASON[session.source]

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

const deadPidReason = (pidAlive: boolean | undefined): string | undefined =>
  pidAlive === false
    ? "The worker pid is no longer alive; the supervisor respawns it on the next attach or peek."
    : undefined

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

const computeScreenDisagrees = ({
  state,
  terminal,
}: {
  readonly state: SessionStateSlug
  readonly terminal: ScreenFacts | undefined
}): boolean => {
  const agrees = terminal === undefined ? undefined : SCREEN_AGREES_WITH[terminal.state]
  if (agrees === undefined || agrees.length === 0) return false
  return !agrees.includes(state)
}

// The parenthetical that lets a human check the claim instead of taking it:
// which matcher fired and the exact line it matched, plus how old the reading
// is. Each part is dropped rather than printed as "undefined" when absent.
const screenProvenance = ({
  terminal,
  ageMs,
}: {
  readonly terminal: ScreenFacts
  readonly ageMs: number | undefined
}): string => {
  const parts = [
    terminal.matcher === undefined ? undefined : `matcher "${terminal.matcher}"`,
    terminal.evidence === undefined ? undefined : `matched "${terminal.evidence}"`,
    ageMs === undefined ? undefined : `observed ${ageMs}ms ago`,
  ].filter((part): part is string => part !== undefined)
  return parts.length === 0 ? "" : ` (${parts.join(", ")})`
}

// The single most useful sentence this endpoint can produce: the supervisor and
// the pane are describing the same session and they do not match.
const screenConflictReason = ({
  disagrees,
  state,
  terminal,
  ageMs,
}: {
  readonly disagrees: boolean
  readonly state: SessionStateSlug
  readonly terminal: ScreenFacts | undefined
  readonly ageMs: number | undefined
}): string | undefined => {
  if (!disagrees || terminal === undefined) return undefined
  return `The screen disagrees: state claims "${state}", but the classified terminal reads "${terminal.state}"${screenProvenance({ terminal, ageMs })}. The screen is a direct reading of the pane rather than something the agent reported, so treat "${state}" as unconfirmed.`
}

const staleReason = ({
  stale,
  state,
  updatedAtAgeMs,
}: {
  readonly stale: boolean
  readonly state: SessionStateSlug
  readonly updatedAtAgeMs: number | undefined
}): string | undefined =>
  stale
    ? `Stale: state claims "${state}" but state.json has not been updated in ${updatedAtAgeMs}ms, past the ${STALE_ACTIVE_MS}ms active-session threshold.`
    : undefined

const buildReasons = ({
  session,
  stateFilePresent,
  pidAlive,
  stale,
  updatedAtAgeMs,
  screen,
}: {
  readonly session: SessionState
  readonly stateFilePresent: boolean
  readonly pidAlive: boolean | undefined
  readonly stale: boolean
  readonly updatedAtAgeMs: number | undefined
  readonly screen: {
    readonly disagrees: boolean
    readonly terminal: ScreenFacts | undefined
    readonly ageMs: number | undefined
  }
}): ReadonlyArray<string> => {
  const conditional = [
    degradedReason(session.degradedFrom),
    missingStateFileReason({ source: session.source, stateFilePresent }),
    deadPidReason(pidAlive),
    staleReason({ stale, state: session.state, updatedAtAgeMs }),
    screenConflictReason({
      disagrees: screen.disagrees,
      state: session.state,
      terminal: screen.terminal,
      ageMs: screen.ageMs,
    }),
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
}: ExplainInput): Explanation => {
  const updatedAtAgeMs = ageMs({ now, createdAtMs: updatedAtMs })
  const lastEventAgeMs = ageMs({ now, createdAtMs: lastEventAtMs })
  const stale = computeStale({ state: session.state, updatedAtAgeMs })
  const screenAgeMs = ageMs({ now, createdAtMs: terminal?.atMs })
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
            ageMs: screenAgeMs,
          },
    screenDisagrees,
    reasons: buildReasons({
      session,
      stateFilePresent,
      pidAlive,
      stale,
      updatedAtAgeMs,
      screen: { disagrees: screenDisagrees, terminal, ageMs: screenAgeMs },
    }),
  }
}
