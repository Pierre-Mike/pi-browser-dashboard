// Imperative shell for the unattended-terminal state poller: spawns zellij,
// schedules the passes, and writes each result through injected ports.
//
// Shaped as a plain factory over ports rather than as an Effect service, for
// the same reason features/rules/rules.io.ts and features/fleet/fleet-run.io.ts
// are: everything this needs to actually DO something — enumerate the terminals
// the daemon knows about, notice which ones have a live WebSocket, write into
// the shared `terminalStates` map, publish on the SSE bus — belongs to
// terminal.routes.ts, and a poller that imported the routes module while the
// routes module constructed the poller would be an import cycle (`bun run
// audit` fails on those). Ports keep the arrow pointing one way and make every
// decision in here testable without a zellij on the box.
//
// Nothing here runs until `start()` is called, and `start()` is called only from
// server.ts's `startDaemon()`. Importing this module — or terminal.routes.ts, or
// api.ts, or any test that touches one of them — must never begin spawning
// subprocesses against the user's live sessions. Same split, same reason, as
// the rules engine's construct-then-start.

import {
  advancePassOffset,
  foldPaneReadings,
  foldScreenDump,
  MAX_DUMPS_PER_PASS,
  MAX_PANES_PER_SESSION,
  type PaneReading,
  type PollCandidate,
  parseSessionList,
  parseTerminalPaneIds,
  rotateTargets,
  selectPanesToDump,
  selectPollTargets,
  type TerminalScope,
  zellijDumpScreenArgv,
  zellijListPanesArgv,
  zellijListSessionsArgv,
} from "./terminal-poll.core"
import { type TerminalStateSlug, terminalPaneRowId } from "./terminal-state.core"

export type PolledState = {
  readonly scope: TerminalScope
  readonly id: string
  readonly state: TerminalStateSlug
  readonly matcher: string | undefined
  readonly evidence: string | undefined
  // Which zellij pane this reading came off. Present on a pane row (where it is
  // also encoded in `id`) AND on the session-level row, where it is the
  // provenance of the fold: which pane's screen the session's state was read
  // from. `undefined` only from a producer that cannot know — the WS classifier
  // tap, which sees one byte stream and no pane ids.
  readonly paneId: string | undefined
}

export type TerminalPollPorts = {
  // Every terminal this daemon can reach, with the zellij session name it would
  // attach to. Supplied by terminal.routes.ts, which already owns the
  // name-derivation rules (and the prefix) for all four scopes.
  readonly listCandidates: () => Promise<ReadonlyArray<PollCandidate>>
  // Raw stdout of the three zellij reads. Text in, parsing in the pure core.
  readonly listSessions: () => Promise<string>
  readonly listPanes: (input: { readonly sessionName: string }) => Promise<string>
  readonly dumpScreen: (input: {
    readonly sessionName: string
    readonly paneId: string
  }) => Promise<string>
  // Zellij session names with a live terminal WebSocket right now.
  readonly attachedSessionNames: () => ReadonlyArray<string>
  // Last known state for a `terminalStateKey`, read from the SAME map the WS
  // tap writes, so a terminal the user just closed the browser tab on does not
  // get a redundant transition event on the next pass.
  readonly priorState: (input: { readonly key: string }) => TerminalStateSlug | undefined
  readonly publish: (input: PolledState) => void
  // Every successful dump's text, offered on EVERY pass — deliberately not
  // behind the publish-on-change gate below. A `wait --until-output` pattern
  // can appear while the classification stays identical (a new line printed by
  // a session that is still `working` is the normal case), so gating this the
  // way `publish` is gated would make the common case invisible.
  //
  // Separate from `publish` because that one lands on the SSE bus, which every
  // connected browser is subscribed to: screen text must never go there.
  readonly noteScreen: (input: ScreenText) => void
  // Drop the stored rows of panes that are no longer there. Called once per
  // successfully listed session with the pane ids that SHOULD still have a row —
  // empty for a single-pane session, which has no pane rows at all. Never called
  // when `listPanes` failed: a hiccup is not a closed pane.
  readonly forgetPaneStates: (input: {
    readonly scope: TerminalScope
    readonly id: string
    readonly keepPaneIds: ReadonlyArray<string>
  }) => void
  readonly now: () => number
}

export type ScreenText = {
  readonly scope: TerminalScope
  readonly id: string
  readonly text: string
  // The pane the text came off. `id` stays the SESSION's id even for a second
  // pane's screen, because `wait --until-output` matches a pattern against a
  // roster short — text on any pane of that session is text on that session's
  // screen. The pane id rides along as provenance.
  readonly paneId: string
}

export type TerminalPollerApi = {
  // Arms the interval. `intervalMs <= 0` — or a non-finite one, which is what a
  // typo'd PID_TERMINAL_POLL_MS becomes on the way through Number() — disables
  // the poller completely: no timer, and `refreshIfStale` stays inert too.
  // Idempotent.
  readonly start: (input: { readonly intervalMs: number }) => void
  readonly stop: () => void
  // One full pass. Overlapping calls share the in-flight pass rather than
  // doubling the subprocess load.
  readonly tick: () => Promise<void>
  // Refresh-on-read hook for GET /terminal/states. This daemon has previously
  // lost its entire timer subsystem on a long uptime while its sockets stayed
  // alive — features/sessions/sessions.io.ts refreshes on read for exactly that
  // reason — so the interval is not allowed to be the only thing keeping polled
  // state fresh. Fire-and-forget on purpose: the caller gets the map as it
  // stands now and the pass's own results arrive over the `terminal.state` SSE
  // event (plus the next read), rather than making a chip request block on two
  // subprocess spawns per unattended session.
  readonly refreshIfStale: () => void
  // Whether passes are actually armed. A `wait --until-output` resolves off
  // these passes and nothing else, so with polling disabled such a wait could
  // only ever time out — the sessions routes read this to refuse the request
  // up front instead.
  readonly isEnabled: () => boolean
}

export const createTerminalPoller = (input: {
  readonly ports: TerminalPollPorts
  readonly tailMaxChars: number
}): TerminalPollerApi => {
  const { ports, tailMaxChars } = input
  let timer: ReturnType<typeof setInterval> | undefined
  let intervalMs = 0
  let inFlight: Promise<void> | undefined
  let lastPassAt: number | undefined

  // Cursor into the target list, so a pass truncated by MAX_DUMPS_PER_PASS
  // resumes where the last one stopped rather than re-reading the same head
  // forever. 0 on a machine small enough for one pass to cover everything.
  let passOffset = 0

  // One pane: dump, classify, offer the text to output waits, and publish the
  // pane's own row when the session has more than one pane. Returns the reading
  // so the caller can fold the session-level row out of every pane it read.
  const pollPane = async (input: {
    readonly target: PollCandidate
    readonly paneId: string
    readonly ownRow: boolean
  }): Promise<PaneReading | undefined> => {
    const { target, paneId } = input
    const dump = await ports.dumpScreen({ sessionName: target.sessionName, paneId })
    // An empty dump is not evidence of anything: a pane that has produced no
    // output yet, or a session that died between list-sessions and this call,
    // both look like this. Staying silent leaves the last known state (or no
    // state) in place instead of overwriting it with a guess.
    if (dump.trim() === "") return undefined
    const rowId = input.ownRow ? terminalPaneRowId({ id: target.id, paneId }) : target.id
    const folded = foldScreenDump({
      dump,
      prior: ports.priorState({ key: `${target.scope}:${rowId}` }),
      maxChars: tailMaxChars,
    })
    // Before the transition gate: an output pattern must see every pass, and an
    // observer must never be able to break the poller either, hence the catch.
    // Noted under the SESSION's id whichever pane it came from — see ScreenText.
    try {
      ports.noteScreen({ scope: target.scope, id: target.id, text: folded.text, paneId })
    } catch {
      // An observer that throws is its own problem, not this pass's.
    }
    if (input.ownRow && folded.publish) {
      ports.publish({
        scope: target.scope,
        id: rowId,
        state: folded.classification.state,
        matcher: folded.classification.matcher,
        evidence: folded.classification.evidence,
        paneId,
      })
    }
    return {
      paneId,
      state: folded.classification.state,
      matcher: folded.classification.matcher,
      evidence: folded.classification.evidence,
    }
  }

  // One session: every terminal pane it has (up to the per-session cap), then
  // the session-level row folded out of the panes actually read. Returns how
  // many dumps it spent so the pass can hold its budget.
  const pollOne = async (input: {
    readonly target: PollCandidate
    readonly dumpBudget: number
  }): Promise<number> => {
    const { target } = input
    const paneIds = parseTerminalPaneIds(await ports.listPanes({ sessionName: target.sessionName }))
    const panes = selectPanesToDump({ paneIds, maxPanes: MAX_PANES_PER_SESSION })
    // A pane row exists only where panes can disagree. For the ordinary
    // one-content-pane session it would duplicate the session row, and doubling
    // every entry in `GET /terminal/states` / `pid terminals` buys nothing: the
    // session row already names its pane in `paneId`.
    const ownRows = panes.length > 1
    // Whole sessions, never half of one: a fold over a partial pane set could
    // report `working` for a session whose unread pane is blocked, which is the
    // failure the fold is ordered to avoid in the first place.
    if (panes.length > input.dumpBudget) return 0
    ports.forgetPaneStates({
      scope: target.scope,
      id: target.id,
      keepPaneIds: ownRows ? paneIds : [],
    })
    const readings: PaneReading[] = []
    for (const paneId of panes) {
      // One unreadable pane must not cost the session its other panes. What it
      // does cost is its own contribution to the fold — an unread pane is
      // silence, not a state.
      const reading = await pollPane({ target, paneId, ownRow: ownRows }).catch(() => undefined)
      if (reading !== undefined) readings.push(reading)
    }
    const session = foldPaneReadings({ panes: readings })
    if (session === undefined) return panes.length
    const priorSession = ports.priorState({ key: `${target.scope}:${target.id}` })
    if (priorSession !== session.state) {
      ports.publish({ scope: target.scope, id: target.id, ...session })
    }
    return panes.length
  }

  const runPass = async (): Promise<void> => {
    const [candidates, rawSessions] = await Promise.all([
      ports.listCandidates(),
      ports.listSessions(),
    ])
    const targets = selectPollTargets({
      candidates,
      sessions: parseSessionList(rawSessions),
      attachedSessionNames: ports.attachedSessionNames(),
    })
    // Sequential by design. Each pane costs a subprocess spawn on top of the
    // session's `list-panes`, and fanning them out would turn a machine with a
    // dozen sessions into a spawn storm every interval. A session that dies
    // mid-pass must not take the rest of the pass with it, hence the per-target
    // catch.
    let budget = MAX_DUMPS_PER_PASS
    let visited = 0
    for (const target of rotateTargets({ targets, offset: passOffset })) {
      if (budget <= 0) break
      budget -= await pollOne({ target, dumpBudget: budget }).catch(() => 0)
      visited += 1
    }
    passOffset = advancePassOffset({ offset: passOffset, visited, total: targets.length })
  }

  const tick = (): Promise<void> => {
    const existing = inFlight
    if (existing !== undefined) return existing
    const pass = runPass()
      .catch(() => undefined)
      .then(() => {
        lastPassAt = ports.now()
        inFlight = undefined
      })
    inFlight = pass
    return pass
  }

  const start = (args: { readonly intervalMs: number }): void => {
    // `!(x > 0)` rather than `x <= 0` so NaN lands on the disabled side: NaN
    // fails every comparison, and setInterval reads a NaN delay as 0, so the
    // looser guard would turn one typo'd env var into a continuous zellij spawn
    // loop against the user's live sessions.
    if (!(args.intervalMs > 0) || timer !== undefined) return
    intervalMs = args.intervalMs
    void tick()
    timer = setInterval(() => {
      void tick()
    }, args.intervalMs)
  }

  const stop = (): void => {
    if (timer !== undefined) clearInterval(timer)
    timer = undefined
    intervalMs = 0
  }

  const refreshIfStale = (): void => {
    // `intervalMs === 0` covers both "never started" and "disabled by config".
    if (intervalMs <= 0 || inFlight !== undefined) return
    if (lastPassAt !== undefined && ports.now() - lastPassAt < intervalMs) return
    void tick()
  }

  // `intervalMs` is 0 both before start() and after a start() the guard
  // rejected, so this is the same test `refreshIfStale` uses for "inert".
  const isEnabled = (): boolean => intervalMs > 0

  return { start, stop, tick, refreshIfStale, isEnabled }
}
