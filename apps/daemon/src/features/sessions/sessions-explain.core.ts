// Pure state-provenance decision logic for GET /:id/explain. No I/O — the pid
// probe, disk existence check and clock all live in sessions.io.ts; this file
// only turns already-resolved facts into a human-readable explanation.

import { ageMs, type SessionState, type SessionStateSlug } from "./sessions.core"

export const STALE_ACTIVE_MS = 120_000

export type ExplainInput = {
  readonly session: SessionState
  readonly now: number // epoch ms, resolved by the shell
  readonly updatedAtMs: number | undefined // Date.parse of session.updatedAt, by the shell
  readonly lastEventAtMs: number | undefined // last time the daemon published for this short
  readonly pidAlive: boolean | undefined // undefined = no pid known
  readonly stateFilePresent: boolean
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
}: {
  readonly session: SessionState
  readonly stateFilePresent: boolean
  readonly pidAlive: boolean | undefined
  readonly stale: boolean
  readonly updatedAtAgeMs: number | undefined
}): ReadonlyArray<string> => {
  const conditional = [
    degradedReason(session.degradedFrom),
    missingStateFileReason({ source: session.source, stateFilePresent }),
    deadPidReason(pidAlive),
    staleReason({ stale, state: session.state, updatedAtAgeMs }),
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
}: ExplainInput): Explanation => {
  const updatedAtAgeMs = ageMs({ now, createdAtMs: updatedAtMs })
  const lastEventAgeMs = ageMs({ now, createdAtMs: lastEventAtMs })
  const stale = computeStale({ state: session.state, updatedAtAgeMs })
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
    reasons: buildReasons({ session, stateFilePresent, pidAlive, stale, updatedAtAgeMs }),
  }
}
