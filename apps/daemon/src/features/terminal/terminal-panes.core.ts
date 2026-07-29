// Pure decisions for the daemon's ONLY write surface into zellij: open a pane in
// a terminal it derived and owns, and close a pane it opened itself. Everything
// else the daemon does with zellij is a read (`list-sessions`, `action
// list-panes`, `action dump-screen --pane-id`) plus attaching a WS bridge, and
// that was deliberate — a pane existed because a human made it.
//
// The refusal discipline is the feature. What this module can express is bounded
// by construction, not by care:
//
//   - A request names a `scope` and an `id`, never a zellij session NAME. The
//     name is looked up through the daemon's own candidate list — the same
//     derivation the screen poller uses (`selectPollTargets`) — intersected with
//     what `zellij list-sessions` reports as live and not EXITED. A caller
//     therefore cannot ask for a session the daemon did not derive, because it
//     has no way to say one. There is no name-shape heuristic anywhere here.
//   - Only two argv shapes exist in this file: `action new-pane` and
//     `action close-pane`. `kill-session`, `delete-session` and
//     `kill-all-sessions` are not built, cannot be built, and a test asserts it.
//   - Closing requires a bookkeeping record the daemon wrote when it created
//     that pane, AND the live pane still carrying the name the daemon minted.
//     The record lives in memory only, so a daemon restart loses it and every
//     close after a restart is refused: the daemon cannot know it created that
//     pane, and guessing is how you close a human's work.
//
// Four zellij behaviours were measured against 0.44.3 before this was written,
// because three of them are traps:
//
//   1. `action new-pane` prints the created pane id (`terminal_<n>`) on stdout
//      and exits 0. That string is the only reason the daemon can ever know
//      which pane is its own.
//   2. `--cwd /does/not/exist` is ACCEPTED. zellij creates the pane anyway and
//      runs the command somewhere else entirely, silently. So the daemon checks
//      the directory itself and refuses — a pane running in the wrong directory
//      is worse than no pane, and `Bun.spawn` into a missing cwd has taken this
//      daemon down before (which is also why the requested directory is passed
//      as an ARGUMENT and never as the spawn's own cwd).
//   3. Pane ids are monotonic within a session and never reused, so within one
//      daemon lifetime an id identifies one pane. A recreated session starts at
//      `terminal_0` again, which is why identity is id AND minted name.
//   4. `--name` survives a program setting its own OSC title, so the minted name
//      stays checkable for the pane's whole life. (Pane 0 of a fresh session, by
//      contrast, shows whatever title the shell sets.)
//   5. Closing a session's ONLY pane leaves the session alive with zero panes —
//      a teardown by another name. Refused: `last_pane`.

import { Either } from "effect"
import {
  MAX_PANES_PER_SESSION,
  type PollCandidate,
  parseTerminalPaneRows,
  type ZellijSessionLine,
} from "./terminal-poll.core"

// ---- vocabulary ---------------------------------------------------------

// Refusals are values, and each one is its own word: a caller that gets
// `last_pane` must be able to tell it apart from `not_created_here` without
// parsing prose.
export type CreateRefusal = "not_derived" | "not_live" | "cwd_missing" | "pane_budget"
export type CloseRefusal =
  | "not_derived"
  | "not_live"
  | "not_created_here"
  | "own_pane"
  | "last_pane"
export type PaneRefusal = CreateRefusal | CloseRefusal

// Every refusal this surface can answer with, as data — so the agent-facing doc
// can be checked against it instead of hand-listing the vocabulary a second time
// (platform/agent-skill.test.ts does exactly that).
export const PANE_REFUSALS: ReadonlyArray<PaneRefusal> = [
  "not_derived",
  "not_live",
  "cwd_missing",
  "pane_budget",
  "not_created_here",
  "own_pane",
  "last_pane",
]

export type ParseError = { readonly message: string }

const parseError = (message: string): ParseError => ({ message })

// The scopes a terminal can have. Kept as a literal list rather than imported as
// a type-only union so a bad `scope` in a request body is rejected by a value
// check, not by a cast.
const SCOPES = ["global", "orchestrator", "project", "session"] as const
type Scope = (typeof SCOPES)[number]

const isScope = (raw: unknown): raw is Scope =>
  typeof raw === "string" && (SCOPES as ReadonlyArray<string>).includes(raw)

// ---- pane ids and minted names -----------------------------------------

const TERMINAL_PANE_RE = /^terminal_(\d+)$/
const BARE_PANE_RE = /^(\d+)$/

// `list-panes` and `close-pane --pane-id` speak `terminal_<n>`; the
// `ZELLIJ_PANE_ID` a process sees inside its own pane is the bare number. Both
// spellings must resolve to the same pane, and everything else — a plugin pane,
// a path, an empty string — resolves to nothing at all.
export const normalizePaneId = (raw: string): string | undefined => {
  if (TERMINAL_PANE_RE.test(raw)) return raw
  const bare = BARE_PANE_RE.exec(raw)?.[1]
  return bare === undefined ? undefined : `terminal_${bare}`
}

// `action new-pane` prints the id it created and nothing else. A failure prints
// prose (and, for an unknown session, its entire session list), so anything that
// is not exactly one pane id reads as "no id".
export const parseCreatedPaneId = (stdout: string): string | undefined => {
  const first = stdout.trim().split("\n")[0]?.trim()
  if (first === undefined) return undefined
  return TERMINAL_PANE_RE.test(first) ? first : undefined
}

// The name the daemon puts on a pane it created, and later checks before closing
// it. Deliberately carries NO caller input: nothing to sanitize, nothing a
// caller can spoof by asking for a name that looks minted.
export const mintPaneName = (input: { readonly seq: number }): string => `pid-pane-${input.seq}`

// ---- ownership ---------------------------------------------------------

// The daemon's derivation and zellij's liveness, intersected. This is the only
// way a session name enters the write path.
export const resolveOwnedSession = (input: {
  readonly scope: string
  readonly id: string
  readonly candidates: ReadonlyArray<PollCandidate>
  readonly sessions: ReadonlyArray<ZellijSessionLine>
}): Either.Either<string, "not_derived" | "not_live"> => {
  const derived = input.candidates.find((c) => c.scope === input.scope && c.id === input.id)
  if (derived === undefined) return Either.left("not_derived")
  const live = input.sessions.some((s) => !s.exited && s.name === derived.sessionName)
  return live ? Either.right(derived.sessionName) : Either.left("not_live")
}

// ---- argv --------------------------------------------------------------

// The two shapes this module can build, and the whole of what the daemon can do
// to zellij's state. `--` terminates the flags so a caller's command is argv to
// zellij and never a shell string.
export const zellijNewPaneArgv = (input: {
  readonly sessionName: string
  readonly paneName: string
  readonly cwd?: string | undefined
  readonly command?: ReadonlyArray<string> | undefined
}): ReadonlyArray<string> => [
  "zellij",
  "--session",
  input.sessionName,
  "action",
  "new-pane",
  "--name",
  input.paneName,
  ...(input.cwd === undefined ? [] : ["--cwd", input.cwd]),
  ...(input.command === undefined || input.command.length === 0 ? [] : ["--", ...input.command]),
]

export const zellijClosePaneArgv = (input: {
  readonly sessionName: string
  readonly paneId: string
}): ReadonlyArray<string> => [
  "zellij",
  "--session",
  input.sessionName,
  "action",
  "close-pane",
  "--pane-id",
  input.paneId,
]

// ---- create ------------------------------------------------------------

export type CreateDecision =
  | {
      readonly _tag: "Create"
      readonly sessionName: string
      readonly paneName: string
      readonly argv: ReadonlyArray<string>
    }
  | { readonly _tag: "Refused"; readonly reason: CreateRefusal }

export const decideCreatePane = (input: {
  readonly scope: string
  readonly id: string
  readonly candidates: ReadonlyArray<PollCandidate>
  readonly sessions: ReadonlyArray<ZellijSessionLine>
  readonly cwd: string | undefined
  // Whether that directory exists, read by the io tier. `undefined` when no cwd
  // was asked for — the pane then inherits whatever zellij's session uses.
  readonly cwdExists: boolean | undefined
  readonly command: ReadonlyArray<string> | undefined
  readonly paneName: string
  // How many TERMINAL panes the session already has.
  readonly terminalPaneCount: number
}): CreateDecision => {
  const owned = resolveOwnedSession(input)
  if (Either.isLeft(owned)) return { _tag: "Refused", reason: owned.left }
  if (input.cwd !== undefined && input.cwdExists !== true) {
    return { _tag: "Refused", reason: "cwd_missing" }
  }
  // A pane past the poller's per-session cap would never be classified, so
  // creating one would hand the caller a pane nothing can observe — the opposite
  // of the point of having panes at all.
  if (input.terminalPaneCount >= MAX_PANES_PER_SESSION) {
    return { _tag: "Refused", reason: "pane_budget" }
  }
  return {
    _tag: "Create",
    sessionName: owned.right,
    paneName: input.paneName,
    argv: zellijNewPaneArgv({
      sessionName: owned.right,
      paneName: input.paneName,
      cwd: input.cwd,
      command: input.command,
    }),
  }
}

// ---- close -------------------------------------------------------------

// What the daemon wrote down when it created a pane. Held in memory only — see
// this module's header for why persisting it would be less safe, not more.
export type CreatedPane = {
  readonly scope: string
  readonly id: string
  readonly paneId: string
  readonly paneName: string
  readonly sessionName: string
}

export type CloseDecision =
  | { readonly _tag: "Close"; readonly sessionName: string; readonly argv: ReadonlyArray<string> }
  // The pane is not there any more (the command exited and the user closed it,
  // or a human closed it by hand). The caller's goal already holds, so this is
  // not a refusal — but the record is dropped either way.
  | { readonly _tag: "AlreadyGone" }
  | { readonly _tag: "Refused"; readonly reason: CloseRefusal }

export const decideClosePane = (input: {
  // Absent when the daemon has no record of creating this pane — including every
  // record a restart threw away.
  readonly record: CreatedPane | undefined
  // Raw `action list-panes` output for the session, so the live pane's NAME can
  // be checked and not just its id.
  readonly panes: string
  // Both self-reported by the caller from its own environment
  // (`ZELLIJ_PANE_ID` / `ZELLIJ_SESSION_NAME`), therefore untrusted: they can
  // only ever make this refuse, never let it do more.
  readonly callerPaneId: string | undefined
  readonly callerSessionName: string | undefined
}): CloseDecision => {
  const { record } = input
  if (record === undefined) return { _tag: "Refused", reason: "not_created_here" }
  const callerPane =
    input.callerPaneId === undefined ? undefined : normalizePaneId(input.callerPaneId)
  if (callerPane === record.paneId && input.callerSessionName === record.sessionName) {
    return { _tag: "Refused", reason: "own_pane" }
  }
  const rows = parseTerminalPaneRows(input.panes)
  const live = rows.find((row) => row.paneId === record.paneId)
  if (live === undefined) return { _tag: "AlreadyGone" }
  // Id plus minted name. An id alone is not an identity across a recreated
  // session, and a pane whose name is no longer the minted one is not
  // demonstrably the daemon's work any more.
  if (live.title !== record.paneName) return { _tag: "Refused", reason: "not_created_here" }
  // Verified against zellij 0.44.3: closing the last pane leaves the session
  // alive with zero panes. That is a session teardown wearing a pane's clothes.
  if (rows.length <= 1) return { _tag: "Refused", reason: "last_pane" }
  return {
    _tag: "Close",
    sessionName: record.sessionName,
    argv: zellijClosePaneArgv({ sessionName: record.sessionName, paneId: record.paneId }),
  }
}

// ---- request shapes ----------------------------------------------------

export type PaneCreateRequest = {
  readonly scope: string
  readonly id: string
  readonly cwd: string | undefined
  readonly command: ReadonlyArray<string> | undefined
}

export type PaneCloseRequest = {
  readonly scope: string
  readonly id: string
  readonly paneId: string
  readonly callerPaneId: string | undefined
  readonly callerSessionName: string | undefined
}

// The command reaches zellij as argv, so there is no shell to inject into — but
// an unbounded argv is still a way to hand the daemon a megabyte to spawn.
const MAX_COMMAND_PARTS = 32
const MAX_COMMAND_PART_CHARS = 4_096
const MAX_PATH_CHARS = 4_096

const isPlainObject = (raw: unknown): raw is Record<string, unknown> =>
  typeof raw === "object" && raw !== null && !Array.isArray(raw)

const optionalString = (raw: unknown): string | undefined =>
  typeof raw === "string" && raw.length > 0 ? raw : undefined

const isCommandPart = (part: unknown): part is string =>
  typeof part === "string" && part.length > 0 && part.length <= MAX_COMMAND_PART_CHARS

const parseCommand = (
  raw: unknown,
): Either.Either<ReadonlyArray<string> | undefined, ParseError> => {
  if (raw === undefined || raw === null) return Either.right(undefined)
  if (!Array.isArray(raw)) return Either.left(parseError("command must be an array of strings"))
  if (raw.length === 0 || raw.length > MAX_COMMAND_PARTS) {
    return Either.left(parseError(`command must hold 1..${MAX_COMMAND_PARTS} strings`))
  }
  const parts = raw.filter(isCommandPart)
  return parts.length === raw.length
    ? Either.right(parts)
    : Either.left(parseError("command must hold non-empty strings"))
}

// scope + id, and nothing that could name a session directly.
const parseTarget = (
  raw: Record<string, unknown>,
): Either.Either<{ readonly scope: string; readonly id: string }, ParseError> => {
  if (!isScope(raw.scope)) {
    return Either.left(parseError(`scope must be one of ${SCOPES.join(", ")}`))
  }
  const id = optionalString(raw.id)
  if (id === undefined) return Either.left(parseError("id is required"))
  return Either.right({ scope: raw.scope, id })
}

export const parsePaneCreateRequest = (
  raw: unknown,
): Either.Either<PaneCreateRequest, ParseError> => {
  if (!isPlainObject(raw))
    return Either.left(parseError("body must be an object with scope and id"))
  const target = parseTarget(raw)
  if (Either.isLeft(target)) return Either.left(target.left)
  if (raw.cwd !== undefined && typeof raw.cwd !== "string") {
    return Either.left(parseError("cwd must be a string path"))
  }
  const cwd = optionalString(raw.cwd)
  if (cwd !== undefined && cwd.length > MAX_PATH_CHARS) {
    return Either.left(parseError("cwd is too long"))
  }
  const command = parseCommand(raw.command)
  if (Either.isLeft(command)) return Either.left(command.left)
  return Either.right({ ...target.right, cwd, command: command.right })
}

export const parsePaneCloseRequest = (
  raw: unknown,
): Either.Either<PaneCloseRequest, ParseError> => {
  if (!isPlainObject(raw))
    return Either.left(parseError("body must be an object with scope and id"))
  const target = parseTarget(raw)
  if (Either.isLeft(target)) return Either.left(target.left)
  const rawPaneId = optionalString(raw.paneId)
  const paneId = rawPaneId === undefined ? undefined : normalizePaneId(rawPaneId)
  if (paneId === undefined) {
    return Either.left(parseError("paneId must be a terminal pane id (terminal_1, or 1)"))
  }
  return Either.right({
    ...target.right,
    paneId,
    // Carried through as given, bogus or not: these two can only ever make the
    // daemon refuse, so rejecting a nonsense value would trade a refusal for an
    // error without protecting anything.
    callerPaneId: optionalString(raw.callerPaneId),
    callerSessionName: optionalString(raw.callerSessionName),
  })
}

// ---- responses ---------------------------------------------------------

// `not_derived` / `not_live` are the daemon saying it has no such terminal, which
// is the 404 every other `pid` command already maps to exit 6. `cwd_missing` is a
// bad argument (400). The rest are policy: the request is well formed and the
// answer is still no, which is a 409 rather than a 400 for the same reason
// `screen_polling_disabled` is.
export const refusalStatus = (reason: PaneRefusal): 400 | 404 | 409 => {
  if (reason === "not_derived" || reason === "not_live") return 404
  if (reason === "cwd_missing") return 400
  return 409
}

// One sentence per refusal, so the reason slug an orchestrating agent switches on
// arrives with an explanation a human reading a log does not have to look up.
// Exhaustive by type: a new refusal cannot be added without a message.
const REFUSAL_MESSAGES: Readonly<Record<PaneRefusal, string>> = {
  not_derived:
    "this daemon did not derive that terminal, so it has no session to open a pane in — check scope and id against GET /terminal/states",
  not_live: "that terminal's zellij session is not running (or has EXITED and needs resurrecting)",
  cwd_missing:
    "cwd does not exist; zellij would accept it silently and run the command somewhere else, so the request is refused instead",
  pane_budget: `that session already has ${MAX_PANES_PER_SESSION} terminal panes, which is as many as the screen poller classifies — a further pane could not be observed`,
  not_created_here:
    "this daemon has no record of creating that pane (a pane a human made, or any pane created before the daemon last restarted) and never closes one it did not create",
  own_pane: "that is the pane you are calling from; closing it would kill the caller mid-request",
  last_pane:
    "that is the session's only terminal pane, and closing it would leave the session with none — a teardown by another name",
}

export const refusalMessage = (reason: PaneRefusal): string => REFUSAL_MESSAGES[reason]

// A failing `zellij action` prints its whole session list — 60KB of it on the
// machine this was written on. Only the first line ever says anything useful, and
// none of the rest belongs in an HTTP response.
export const boundedDetail = (input: {
  readonly text: string
  readonly maxChars: number
}): string => {
  const first = input.text.trim().split("\n")[0]?.trim() ?? ""
  return first.length > input.maxChars ? `${first.slice(0, input.maxChars)}…` : first
}
