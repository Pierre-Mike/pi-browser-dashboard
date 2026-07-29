import { isSessionStateSlug, SESSION_STATE_SLUGS, type SessionStateSlug } from "@pid/shared"
import { Schema as S } from "effect"

// --- State slug normalization -----------------------------------------------

export type { SessionStateSlug }

// The state vocabulary is a published contract (`shared/src/session.ts`), not a
// local constant. It used to live here, which forced three other pure cores
// (features/fleet, features/rules, apps/cli's agent core) to keep hand-written
// literal copies of it: importing `../sessions/sessions.core` is a cross-slice
// reach into another slice's internals, and the axiom-debt ratchet fails on any
// new one. A `shared/` contract is importable from a pure core at zero debt, so
// those copies are gone and this is the single declaration.

type NormalizedState = {
  readonly slug: SessionStateSlug
  // The raw slug a supervisor sent, when it didn't match a known one — kept so
  // an "unknown" chip can say what it actually saw instead of just its own
  // shrug. `undefined` for the two "there was nothing to degrade" cases: a
  // missing/absent state field, and a recognized slug.
  readonly degradedFrom: string | undefined
}

// Two failure modes used to collapse into the same "idle": a state field that
// is absent, non-string, or empty is the pre-state seed case (nothing to
// report), while a non-empty string that doesn't match a known slug is
// genuine drift — supervisor upgrade, typo, a future state this build
// predates — and gets surfaced as "unknown" rather than a plausible-looking
// "idle" that hides the mismatch.
const normalizeState = (raw: unknown): NormalizedState => {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return { slug: "idle", degradedFrom: undefined }
  }
  const lower = raw.toLowerCase().trim()
  if (isSessionStateSlug(lower)) return { slug: lower, degradedFrom: undefined }
  return { slug: "unknown", degradedFrom: raw }
}

// --- Roster -----------------------------------------------------------------

const RosterWorkerSchema = S.Struct({
  pid: S.optional(S.Number),
  sessionId: S.optional(S.String),
  cwd: S.optional(S.String),
  startedAt: S.optional(S.Number),
  attempt: S.optional(S.Number),
  cliVersion: S.optional(S.String),
  dispatch: S.optional(
    S.Struct({
      agent: S.optional(S.String),
      seed: S.optional(S.Struct({ intent: S.optional(S.String) })),
    }),
  ),
})

const RosterSchema = S.Struct({
  proto: S.optional(S.Number),
  supervisorPid: S.optional(S.Number),
  updatedAt: S.optional(S.Number),
  workers: S.optional(S.Record({ key: S.String, value: RosterWorkerSchema })),
})

export type RosterWorker = {
  readonly short: string
  readonly pid: number | undefined
  readonly sessionId: string | undefined
  readonly cwd: string | undefined
  readonly intent: string | undefined
  readonly startedAt: number | undefined
  readonly agent: string | undefined
}

export type ParsedRoster = {
  readonly supervisorPid: number | undefined
  readonly updatedAt: number | undefined
  readonly workers: ReadonlyArray<RosterWorker>
}

export const parseRoster = (json: unknown): ParsedRoster => {
  const decoded = S.decodeUnknownSync(RosterSchema, { onExcessProperty: "ignore" })(json)
  const workersRecord = decoded.workers ?? {}
  const workers: RosterWorker[] = []
  for (const [short, w] of Object.entries(workersRecord)) {
    workers.push({
      short,
      pid: w.pid,
      sessionId: w.sessionId,
      cwd: w.cwd,
      intent: w.dispatch?.seed?.intent,
      startedAt: w.startedAt,
      agent: w.dispatch?.agent,
    })
  }
  return {
    supervisorPid: decoded.supervisorPid,
    updatedAt: decoded.updatedAt,
    workers,
  }
}

// --- Session state.json -----------------------------------------------------

const OutputSchema = S.Struct({
  result: S.optional(S.Unknown),
})

const NullishOutput = S.NullishOr(OutputSchema)

const StateFileSchema = S.Struct({
  state: S.optional(S.Unknown),
  detail: S.optional(S.NullishOr(S.String)),
  tempo: S.optional(S.NullishOr(S.String)),
  intent: S.optional(S.NullishOr(S.String)),
  name: S.optional(S.NullishOr(S.String)),
  sessionId: S.optional(S.NullishOr(S.String)),
  daemonShort: S.optional(S.NullishOr(S.String)),
  cwd: S.optional(S.NullishOr(S.String)),
  cliVersion: S.optional(S.NullishOr(S.String)),
  createdAt: S.optional(S.NullishOr(S.String)),
  updatedAt: S.optional(S.NullishOr(S.String)),
  linkScanPath: S.optional(S.NullishOr(S.String)),
  worktreePath: S.optional(S.NullishOr(S.String)),
  worktreeBranch: S.optional(S.NullishOr(S.String)),
  output: S.optional(NullishOutput),
})

export type SessionState = {
  readonly short: string
  readonly state: SessionStateSlug
  // Where `state` was last set from: `parseState` (state.json, the session's
  // own status file), `seedFromWorker` (a roster-only placeholder ahead of
  // the first state.json read), or `piSpawnToSession` (pi has no supervisor
  // state.json at all — its state comes from the daemon's own spawn log).
  // Survives both merge helpers below — they only ever touch the
  // roster-derived fields, never `state`/`source`/`degradedFrom`.
  readonly source: "state.json" | "roster-seed" | "pi-spawn-log"
  // The raw slug `normalizeState` couldn't recognize, when `state` is
  // "unknown"; `undefined` otherwise.
  readonly degradedFrom: string | undefined
  readonly detail: string | undefined
  readonly tempo: string | undefined
  readonly intent: string | undefined
  readonly name: string | undefined
  readonly sessionId: string | undefined
  readonly cwd: string | undefined
  readonly createdAt: string | undefined
  readonly updatedAt: string | undefined
  readonly linkScanPath: string | undefined
  readonly worktreePath: string | undefined
  readonly worktreeBranch: string | undefined
  readonly result: unknown
  // Which CLI runs this session. Absent for claude (the historical shape —
  // existing consumers are untouched); "pi" for daemon-spawned pi runs
  // surfaced by features/dispatch/pi-sessions.
  readonly harness?: "pi"
}

export type ParseStateInput = { readonly short: string; readonly json: unknown }

export const parseState = ({ short, json }: ParseStateInput): SessionState => {
  const decoded = S.decodeUnknownSync(StateFileSchema, { onExcessProperty: "ignore" })(json)
  const normalized = normalizeState(decoded.state)
  return {
    short: decoded.daemonShort ?? short,
    state: normalized.slug,
    source: "state.json",
    degradedFrom: normalized.degradedFrom,
    detail: decoded.detail ?? undefined,
    tempo: decoded.tempo ?? undefined,
    intent: decoded.intent ?? undefined,
    name: decoded.name ?? undefined,
    sessionId: decoded.sessionId ?? undefined,
    cwd: decoded.cwd ?? undefined,
    createdAt: decoded.createdAt ?? undefined,
    updatedAt: decoded.updatedAt ?? undefined,
    linkScanPath: decoded.linkScanPath ?? undefined,
    worktreePath: decoded.worktreePath ?? undefined,
    worktreeBranch: decoded.worktreeBranch ?? undefined,
    result: decoded.output?.result,
  }
}

// --- Merging ----------------------------------------------------------------

export const seedFromWorker = (worker: RosterWorker): SessionState => ({
  short: worker.short,
  state: "idle",
  source: "roster-seed",
  degradedFrom: undefined,
  detail: undefined,
  tempo: undefined,
  intent: worker.intent,
  name: undefined,
  sessionId: worker.sessionId,
  cwd: worker.cwd,
  createdAt: undefined,
  updatedAt: undefined,
  linkScanPath: undefined,
  worktreePath: undefined,
  worktreeBranch: undefined,
  result: undefined,
})

const firstDefined = (input: {
  readonly a: string | undefined
  readonly b: string | undefined
}): string | undefined => (input.a === undefined ? input.b : input.a)

type RosterDerived = Pick<SessionState, "intent" | "sessionId" | "cwd">

const fillRosterDerived = (input: {
  readonly target: SessionState
  readonly fallback: RosterDerived
}): SessionState => {
  const { target, fallback } = input
  return {
    ...target,
    intent: firstDefined({ a: target.intent, b: fallback.intent }),
    sessionId: firstDefined({ a: target.sessionId, b: fallback.sessionId }),
    cwd: firstDefined({ a: target.cwd, b: fallback.cwd }),
  }
}

const sameRosterDerived = (input: {
  readonly a: RosterDerived
  readonly b: RosterDerived
}): boolean =>
  input.a.intent === input.b.intent &&
  input.a.sessionId === input.b.sessionId &&
  input.a.cwd === input.b.cwd

export type BackfillInput = { readonly existing: SessionState; readonly worker: RosterWorker }

// Roster-only fields a jobs-dir-seeded session couldn't know. Returns the
// merged session, or null when nothing would change.
export const backfillRosterFields = ({ existing, worker }: BackfillInput): SessionState | null => {
  const merged = fillRosterDerived({ target: existing, fallback: worker })
  return sameRosterDerived({ a: merged, b: existing }) ? null : merged
}

const NO_PRIOR: RosterDerived = { intent: undefined, sessionId: undefined, cwd: undefined }

export type MergeStateInput = {
  readonly parsed: SessionState
  readonly prior: SessionState | undefined
}

// state.json wins, but roster-derived fields survive when it omits them.
export const mergeStateWithPrior = ({ parsed, prior }: MergeStateInput): SessionState =>
  fillRosterDerived({ target: parsed, fallback: prior ?? NO_PRIOR })

// --- Derived ---------------------------------------------------------------

// Both instants arrive as epoch milliseconds: the pure core neither reads the
// clock nor parses dates — the shell resolves `now` and turns a stored ISO
// `createdAt` into epoch ms (`Date.parse`) before calling in.
export type AgeInput = { readonly now: number; readonly createdAtMs: number | undefined }

export const ageMs = ({ now, createdAtMs }: AgeInput): number | undefined => {
  if (createdAtMs === undefined || Number.isNaN(createdAtMs)) return undefined
  return Math.max(0, now - createdAtMs)
}
