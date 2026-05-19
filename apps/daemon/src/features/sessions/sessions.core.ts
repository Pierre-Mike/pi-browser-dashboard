import { Schema as S } from "@effect/schema"

// --- State slug normalization -----------------------------------------------

const KNOWN_STATES = ["done", "working", "needs_input", "idle", "failed", "stopped"] as const
export type SessionStateSlug = (typeof KNOWN_STATES)[number]

const isKnownState = (s: string): s is SessionStateSlug =>
  (KNOWN_STATES as readonly string[]).includes(s)

const normalizeState = (raw: unknown): SessionStateSlug => {
  if (typeof raw !== "string") return "idle"
  const lower = raw.toLowerCase().trim()
  return isKnownState(lower) ? lower : "idle"
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
}

export type ParseStateInput = { readonly short: string; readonly json: unknown }

export const parseState = ({ short, json }: ParseStateInput): SessionState => {
  const decoded = S.decodeUnknownSync(StateFileSchema, { onExcessProperty: "ignore" })(json)
  return {
    short: decoded.daemonShort ?? short,
    state: normalizeState(decoded.state),
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

// --- Derived ---------------------------------------------------------------

export type AgeInput = { readonly now: number; readonly createdAt: string | undefined }

export const ageMs = ({ now, createdAt }: AgeInput): number | undefined => {
  if (!createdAt) return undefined
  const t = Date.parse(createdAt)
  if (Number.isNaN(t)) return undefined
  return Math.max(0, now - t)
}
