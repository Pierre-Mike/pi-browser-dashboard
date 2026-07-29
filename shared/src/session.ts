/**
 * The `SessionState` contract — the daemon's view of one Claude/pi session as
 * it crosses the wire.
 *
 * This was previously declared twice: once in
 * `apps/daemon/src/features/sessions/sessions.core.ts` and once, by hand, in
 * `apps/web/src/lib/types.ts` under a comment admitting it was a "local
 * mirror". The two had already drifted — the mirror was missing
 * `worktreePath`/`worktreeBranch` and typed nine nullable fields as required
 * `string`. One declaration, imported by both, is the fix.
 *
 * Optionality here is *wire* optionality, deliberately: `JSON.stringify` drops
 * keys whose value is `undefined`, so a field the daemon models as
 * `string | undefined` simply does not appear in the response body. Modelling
 * those as `S.optional` is what makes `decodeSessionState` accept real daemon
 * output — and a required-with-`undefined` producer stays assignable to an
 * optional consumer, so the daemon's own literals need no reshaping.
 */
import { Schema as S } from "effect"

/**
 * The state vocabulary. `blocked` is what the current supervisor emits for a
 * session waiting on the user; older CLIs emitted `needs_input` — both are kept
 * so neither version's sessions degrade to `idle`. `unknown` is a slug the
 * daemon did not recognize, surfaced honestly rather than guessed at.
 *
 * Exported as a value (not just a type) so drift guards can assert against the
 * real vocabulary instead of a hand-copied list.
 */
export const SESSION_STATE_SLUGS = [
  "done",
  "working",
  "blocked",
  "needs_input",
  "idle",
  "failed",
  "stopped",
  "unknown",
] as const

export type SessionStateSlug = (typeof SESSION_STATE_SLUGS)[number]

export const isSessionStateSlug = (s: string): s is SessionStateSlug =>
  (SESSION_STATE_SLUGS as readonly string[]).includes(s)

/**
 * Where `state` was last set from: the session's own `state.json`, a
 * roster-only placeholder ahead of the first `state.json` read, or (pi
 * sessions) the daemon's own spawn log — pi has no supervisor `state.json` at
 * all. Always present, so consumers can explain a state instead of only
 * displaying it.
 */
export const SessionStateSource = S.Literal("state.json", "roster-seed", "pi-spawn-log")
export type SessionStateSource = S.Schema.Type<typeof SessionStateSource>

export const SessionState = S.Struct({
  short: S.String,
  state: S.Literal(...SESSION_STATE_SLUGS),
  source: SessionStateSource,
  /** The raw slug the daemon could not recognize, when `state` is "unknown". */
  degradedFrom: S.optional(S.String),
  detail: S.optional(S.String),
  tempo: S.optional(S.String),
  intent: S.optional(S.String),
  name: S.optional(S.String),
  sessionId: S.optional(S.String),
  cwd: S.optional(S.String),
  createdAt: S.optional(S.String),
  updatedAt: S.optional(S.String),
  linkScanPath: S.optional(S.String),
  worktreePath: S.optional(S.String),
  worktreeBranch: S.optional(S.String),
  /** Free-form supervisor payload; shape varies by harness. */
  result: S.optional(S.Unknown),
  /**
   * Which CLI runs this session. Absent for claude (the historical shape, so
   * existing consumers are untouched); "pi" for daemon-spawned pi runs.
   */
  harness: S.optional(S.Literal("pi")),
})

export type SessionState = S.Schema.Type<typeof SessionState>

/**
 * Decode an untrusted `SessionState` (an RPC response body, a fixture).
 *
 * `onExcessProperty: "error"` is the point: an undocumented field means the
 * daemon and this contract have diverged, and failing loudly at the boundary
 * beats a `undefined` surfacing three components deep. Strictness is safe here
 * because the daemon and the web bundle ship as one artifact
 * (`apps/cli/dist-web`) — they are never at different versions in production.
 */
export const decodeSessionState = S.decodeUnknownSync(SessionState, {
  onExcessProperty: "error",
})

export const SessionStateArray = S.Array(SessionState)

export const decodeSessionStateArray = S.decodeUnknownSync(SessionStateArray, {
  onExcessProperty: "error",
})
