// Imperative shell for the daemon's only write surface into zellij: spawn
// `action new-pane` / `action close-pane`, and keep the bookkeeping that says
// which panes are the daemon's own to close.
//
// Shaped as a plain factory over ports for the same reason terminal-poll.io.ts
// is: everything it needs to actually DO something (enumerate the terminals the
// daemon derived, spawn a subprocess, check a directory) belongs to
// terminal.routes.ts, and importing the routes module from here while the routes
// module constructs this would be an import cycle that `bun run audit` fails on.
// Ports also mean every refusal path is testable without a zellij on the box —
// and this is the one module in the slice where a wrong decision writes to the
// user's live machine, so every one of those paths has a test.
//
// The bookkeeping is deliberately IN MEMORY ONLY. Persisting it would make the
// daemon *less* safe, not more: pane ids restart at `terminal_0` for a recreated
// session, so a record that outlived the daemon could name a pane a human made.
// After a restart the daemon cannot know it created anything, so every close is
// refused (`not_created_here`) until it creates a pane again. That is the honest
// answer, and it is pinned by a test that closes through a second writer.

import {
  boundedDetail,
  type CloseRefusal,
  type CreatedPane,
  type CreateRefusal,
  decideClosePane,
  decideCreatePane,
  mintPaneName,
  type PaneCloseRequest,
  type PaneCreateRequest,
  parseCreatedPaneId,
} from "./terminal-panes.core"
import { type PollCandidate, parseSessionList, parseTerminalPaneIds } from "./terminal-poll.core"
import { terminalPaneRowId, terminalStateKey } from "./terminal-state.core"

// Bounds what a failing `zellij action` can put in an HTTP response: an unknown
// session makes it print its entire session list (60KB of it on the machine this
// was written on).
const DETAIL_MAX_CHARS = 200

export type PaneWritePorts = {
  // The daemon's OWN derivation of every terminal it can reach — the same list
  // the screen poller intersects with live sessions. Ownership comes from here
  // and nowhere else.
  readonly listCandidates: () => Promise<ReadonlyArray<PollCandidate>>
  readonly listSessions: () => Promise<string>
  readonly listPanes: (input: { readonly sessionName: string }) => Promise<string>
  // Whether a directory exists RIGHT NOW. Checked before any spawn: zellij
  // accepts a `--cwd` that does not exist and runs the command somewhere else,
  // and `Bun.spawn` into a missing cwd has killed this daemon before.
  readonly directoryExists: (input: { readonly path: string }) => boolean
  // Runs one zellij argv and reports whether it succeeded plus its combined
  // output. Never throws — a spawn that cannot start is `ok: false`.
  readonly runZellij: (input: { readonly argv: ReadonlyArray<string> }) => Promise<{
    readonly ok: boolean
    readonly output: string
  }>
}

export type PaneCreateOutcome =
  | {
      readonly _tag: "Created"
      readonly scope: string
      readonly id: string
      readonly paneId: string
      readonly paneName: string
      readonly sessionName: string
    }
  | { readonly _tag: "Refused"; readonly reason: CreateRefusal }
  | { readonly _tag: "ZellijFailed"; readonly detail: string }

export type PaneCloseOutcome =
  | { readonly _tag: "Closed"; readonly paneId: string }
  | { readonly _tag: "AlreadyGone"; readonly paneId: string }
  | { readonly _tag: "Refused"; readonly reason: CloseRefusal }
  | { readonly _tag: "ZellijFailed"; readonly detail: string }

export type PaneWriterApi = {
  readonly create: (request: PaneCreateRequest) => Promise<PaneCreateOutcome>
  readonly close: (request: PaneCloseRequest) => Promise<PaneCloseOutcome>
}

export const createPaneWriter = (input: { readonly ports: PaneWritePorts }): PaneWriterApi => {
  const { ports } = input
  // Keyed exactly like the screen registry's pane rows (`<scope>:<id>#<paneId>`),
  // so "the pane the daemon created" and "the pane the poller classifies" are
  // the same string in both directions.
  const created = new Map<string, CreatedPane>()
  let mintSeq = 0

  const recordKey = (input: {
    readonly scope: string
    readonly id: string
    readonly paneId: string
  }): string =>
    terminalStateKey({
      scope: input.scope,
      id: terminalPaneRowId({ id: input.id, paneId: input.paneId }),
    })

  const create = async (request: PaneCreateRequest): Promise<PaneCreateOutcome> => {
    const [candidates, rawSessions] = await Promise.all([
      ports.listCandidates(),
      ports.listSessions(),
    ])
    const sessions = parseSessionList(rawSessions)
    // Two reads before the decision, and the decision is pure: whether this
    // terminal is the daemon's, whether the directory is real, and whether the
    // session has room for a pane the poller will actually classify.
    const owned = decideCreatePane({
      scope: request.scope,
      id: request.id,
      candidates,
      sessions,
      cwd: request.cwd,
      cwdExists:
        request.cwd === undefined ? undefined : ports.directoryExists({ path: request.cwd }),
      command: request.command,
      paneName: mintPaneName({ seq: mintSeq + 1 }),
      // Only reachable for a session that resolved, so it is read lazily below
      // rather than spawning a `list-panes` for a session the daemon does not
      // own. `decideCreatePane` is called twice for that reason: once to resolve
      // ownership, once with the pane count.
      terminalPaneCount: 0,
    })
    if (owned._tag === "Refused") return { _tag: "Refused", reason: owned.reason }
    const paneCount = parseTerminalPaneIds(
      await ports.listPanes({ sessionName: owned.sessionName }),
    ).length
    const decision = decideCreatePane({
      scope: request.scope,
      id: request.id,
      candidates,
      sessions,
      cwd: request.cwd,
      cwdExists: request.cwd === undefined ? undefined : true,
      command: request.command,
      paneName: owned.paneName,
      terminalPaneCount: paneCount,
    })
    if (decision._tag === "Refused") return { _tag: "Refused", reason: decision.reason }
    const run = await ports.runZellij({ argv: decision.argv })
    const paneId = run.ok ? parseCreatedPaneId(run.output) : undefined
    if (paneId === undefined) {
      // Either zellij failed, or it succeeded without printing the one thing
      // that lets the daemon know which pane is now its own. Both are failures:
      // an unattributable pane must never enter the bookkeeping.
      return {
        _tag: "ZellijFailed",
        detail: boundedDetail({ text: run.output, maxChars: DETAIL_MAX_CHARS }),
      }
    }
    mintSeq += 1
    const record: CreatedPane = {
      scope: request.scope,
      id: request.id,
      paneId,
      paneName: decision.paneName,
      sessionName: decision.sessionName,
    }
    created.set(recordKey(record), record)
    return {
      _tag: "Created",
      scope: record.scope,
      id: record.id,
      paneId: record.paneId,
      paneName: record.paneName,
      sessionName: record.sessionName,
    }
  }

  const close = async (request: PaneCloseRequest): Promise<PaneCloseOutcome> => {
    const key = recordKey(request)
    const record = created.get(key)
    // No record, no close, and no subprocess: whether the pane exists is not
    // even asked, because the answer could not change the decision.
    if (record === undefined) return { _tag: "Refused", reason: "not_created_here" }
    const decision = decideClosePane({
      record,
      panes: await ports.listPanes({ sessionName: record.sessionName }),
      callerPaneId: request.callerPaneId,
      callerSessionName: request.callerSessionName,
    })
    if (decision._tag === "Refused") return { _tag: "Refused", reason: decision.reason }
    if (decision._tag === "AlreadyGone") {
      // Somebody else closed it. The caller's goal holds, and the daemon has
      // nothing left to be responsible for.
      created.delete(key)
      return { _tag: "AlreadyGone", paneId: record.paneId }
    }
    const run = await ports.runZellij({ argv: decision.argv })
    if (!run.ok) {
      // The record stays: the pane is still the daemon's, and a retry is the
      // right next move.
      return {
        _tag: "ZellijFailed",
        detail: boundedDetail({ text: run.output, maxChars: DETAIL_MAX_CHARS }),
      }
    }
    created.delete(key)
    return { _tag: "Closed", paneId: record.paneId }
  }

  return { create, close }
}
