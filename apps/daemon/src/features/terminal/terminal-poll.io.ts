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
  advanceCadence,
  advancePassOffset,
  foldPaneReadings,
  foldScreenDump,
  isPaneListFresh,
  MAX_PANES_PER_SESSION,
  type PaneReading,
  type PollCadence,
  type PollCandidate,
  parseSessionList,
  parseTerminalPaneIds,
  pollCadenceKey,
  readBudgetForPass,
  rotateTargets,
  screenFingerprint,
  selectDueTargets,
  selectPanesToDump,
  selectPollTargets,
  type TerminalScope,
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
  // "This row's screen was read just now." Called for every row that was
  // actually dumped this pass — each pane row, plus the session-level row folded
  // out of them — whether or not the reading moved, and deliberately NOT paired
  // with an SSE event: ~50 rows every interval, each carrying a classification
  // nobody has changed, is noise on a stream every connected browser reads.
  //
  // Separate from `publish` because the two answer different questions.
  // `publish` is "the pane now says something else" (a transition, worth an
  // event); this is "the evidence is this old" (freshness, worth a stamp). One
  // timestamp cannot mean both, which is exactly the bug this port exists to
  // fix — `explain` rendered the change-time as "observed <age> ago" and
  // understated the reading's own freshness by hours.
  readonly noteRead: (input: { readonly scope: TerminalScope; readonly id: string }) => void
  // Drop the stored rows of panes that are no longer there. Called once per
  // successfully listed session with the pane ids that SHOULD still have a row —
  // empty for a single-pane session, which has no pane rows at all. Never called
  // when `listPanes` failed: a hiccup is not a closed pane.
  readonly forgetPaneStates: (input: {
    readonly scope: TerminalScope
    readonly id: string
    readonly keepPaneIds: ReadonlyArray<string>
  }) => void
  // Is anything waiting on a screen right now? True while a `pid wait
  // --until-output` / `--via screen` observer is registered, and it turns the
  // per-target backoff off for as long as it is: such a wait resolves off these
  // passes and nothing else, so a backed-off target would add up to
  // MAX_BACKOFF_PASSES of latency to a wait that looks exact.
  readonly hasScreenWaiters: () => boolean
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

  // Cursor into the target list, so a pass truncated by MAX_READS_PER_PASS
  // resumes where the last one stopped rather than re-reading the same head
  // forever. 0 on a machine small enough for one pass to cover everything.
  let passOffset = 0

  // Monotonic pass counter — the clock the per-target backoff is measured in.
  // Passes rather than milliseconds because the interval is the unit the whole
  // module already thinks in, and because a pass that took longer than the
  // interval must not make every target instantly due again.
  let pass = 0

  // Per-target read cadence (`<scope>:<id>` -> PollCadence) and the fingerprint
  // of the last screen seen for each ROW (`<scope>:<id>` for a session-level row,
  // `<scope>:<id>#<paneId>` for a pane's own) — the pair that decides whether a
  // terminal is moving and therefore worth the next pass.
  const cadences = new Map<string, PollCadence>()
  const fingerprints = new Map<string, string>()

  // Cached pane lists, so the ordinary pass costs one read per target instead of
  // two. Keyed by zellij session NAME, which is what `list-panes` is addressed
  // by, and invalidated early by an empty dump (a pane that has gone away).
  const paneLists = new Map<string, { paneIds: ReadonlyArray<string>; listedAtPass: number }>()

  // One pane: dump, classify, offer the text to output waits, and publish the
  // pane's own row when the session has more than one pane. Returns the reading
  // so the caller can fold the session-level row out of every pane it read, plus
  // whether this pane's screen actually moved since the last read — the signal the
  // per-target backoff runs on.
  const pollPane = async (input: {
    readonly target: PollCandidate
    readonly paneId: string
    readonly ownRow: boolean
  }): Promise<{ readonly reading: PaneReading; readonly changed: boolean } | undefined> => {
    const { target, paneId } = input
    const dump = await ports.dumpScreen({ sessionName: target.sessionName, paneId })
    // An empty dump is not evidence of anything: a pane that has produced no
    // output yet, or a session that died between list-sessions and this call,
    // both look like this. Staying silent leaves the last known state (or no
    // state) in place instead of overwriting it with a guess.
    //
    // It IS evidence about the cached pane list, though: a pane id that dumps
    // nothing may be a pane that has gone away, and trusting the cache for the
    // rest of its window would keep spending a read on it and keep its row alive.
    // Dropping the entry costs one `list-panes` on the next pass.
    if (dump.trim() === "") {
      paneLists.delete(target.sessionName)
      return undefined
    }
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
    // A pane row's freshness, stamped from the pane that owns it. The
    // session-level row is stamped by the caller instead, once per pass, off the
    // fold — so a single-pane session (which has no pane row at all) is not
    // stamped twice for one dump.
    if (input.ownRow) {
      ports.noteRead({ scope: target.scope, id: rowId })
      if (folded.publish) {
        ports.publish({
          scope: target.scope,
          id: rowId,
          state: folded.classification.state,
          matcher: folded.classification.matcher,
          evidence: folded.classification.evidence,
          paneId,
        })
      }
    }
    // Did this pane's screen move? Fingerprint the bounded, ANSI-stripped text
    // `foldScreenDump` already produced — the same window the classifier read, so
    // "changed" means changed in the part that can change a classification. A
    // transition counts as movement on its own: the two can only disagree on a
    // fingerprint collision, and taking either as movement fails safe.
    const rowKey = `${target.scope}:${rowId}`
    const fingerprint = screenFingerprint({ text: folded.text })
    const moved = fingerprints.get(rowKey) !== fingerprint
    fingerprints.set(rowKey, fingerprint)
    return {
      changed: moved || folded.publish,
      reading: {
        paneId,
        state: folded.classification.state,
        matcher: folded.classification.matcher,
        evidence: folded.classification.evidence,
      },
    }
  }

  // This session's pane ids, from the cache when it is still good and from zellij
  // otherwise. `reads` is what it cost, so the pass can hold one budget over every
  // kind of read it makes; `listed` says whether the ids are fresh evidence, which
  // is what `forgetPaneStates` needs — a cached list is not proof a pane closed.
  // The fewest reads this target can possibly cost: one dump, plus the pane list
  // when there is no fresh one to reuse. The pass checks this BEFORE spending
  // anything, which is what stops its last read being a `list-panes` for a session
  // it can no longer afford to dump — a connection made, every open terminal
  // repainted, and nothing classified.
  const minReadsFor = (input: { readonly target: PollCandidate }): number =>
    cachedPaneIds({ sessionName: input.target.sessionName }) === undefined ? 2 : 1

  const cachedPaneIds = (input: {
    readonly sessionName: string
  }): ReadonlyArray<string> | undefined => {
    const cached = paneLists.get(input.sessionName)
    if (cached === undefined) return undefined
    return isPaneListFresh({ listedAtPass: cached.listedAtPass, pass }) ? cached.paneIds : undefined
  }

  const paneIdsFor = async (input: {
    readonly target: PollCandidate
  }): Promise<{
    readonly paneIds: ReadonlyArray<string>
    readonly reads: number
    readonly listed: boolean
  }> => {
    const { sessionName } = input.target
    const cached = cachedPaneIds({ sessionName })
    if (cached !== undefined) return { paneIds: cached, reads: 0, listed: false }
    const paneIds = parseTerminalPaneIds(await ports.listPanes({ sessionName }))
    paneLists.set(sessionName, { paneIds, listedAtPass: pass })
    return { paneIds, reads: 1, listed: true }
  }

  // Every pane of one session, in order. One unreadable pane must not cost the
  // session its other panes; what it does cost is its own contribution to the
  // fold, because an unread pane is silence and not a state.
  const readPanes = async (input: {
    readonly target: PollCandidate
    readonly panes: ReadonlyArray<string>
    readonly ownRows: boolean
  }): Promise<{ readonly readings: ReadonlyArray<PaneReading>; readonly moved: boolean }> => {
    const readings: PaneReading[] = []
    let moved = false
    for (const paneId of input.panes) {
      const polled = await pollPane({
        target: input.target,
        paneId,
        ownRow: input.ownRows,
      }).catch(() => undefined)
      if (polled !== undefined) {
        readings.push(polled.reading)
        moved = moved || polled.changed
      }
    }
    return { readings, moved }
  }

  // The session-level row for a set of pane readings, plus this target's next
  // cadence. Split out of pollOne so the read-budget arithmetic and the
  // publish-and-schedule decision are two things instead of one long one.
  const settleSession = (input: {
    readonly target: PollCandidate
    readonly readings: ReadonlyArray<PaneReading>
    readonly moved: boolean
  }): void => {
    const { target } = input
    const session = foldPaneReadings({ panes: input.readings })
    // Nothing readable: the target was NOT read, so it keeps whatever cadence it
    // had and stays due. Advancing the backoff here would let a session that is
    // failing to dump talk itself down to one attempt every backoff window.
    if (session === undefined) return
    // The session's screen WAS read this pass — that is what a fold over at least
    // one pane means — so stamp it before the transition gate below decides
    // whether anything changed. Nothing published is not the same as nothing read.
    ports.noteRead({ scope: target.scope, id: target.id })
    const cadenceKey = pollCadenceKey({ scope: target.scope, id: target.id })
    const published = ports.priorState({ key: cadenceKey }) !== session.state
    if (published) ports.publish({ scope: target.scope, id: target.id, ...session })
    cadences.set(
      cadenceKey,
      advanceCadence({
        cadence: cadences.get(cadenceKey),
        pass,
        changed: input.moved || published,
      }),
    )
  }

  // One session: every terminal pane it has (up to the per-session cap), then
  // the session-level row folded out of the panes actually read. Returns how many
  // zellij reads it spent — the pane list, when it had to fetch one, plus one per
  // dump — so the pass can hold its budget.
  const pollOne = async (input: {
    readonly target: PollCandidate
    readonly readBudget: number
  }): Promise<number> => {
    const { target } = input
    const list = await paneIdsFor({ target })
    const panes = selectPanesToDump({ paneIds: list.paneIds, maxPanes: MAX_PANES_PER_SESSION })
    // A pane row exists only where panes can disagree. For the ordinary
    // one-content-pane session it would duplicate the session row, and doubling
    // every entry in `GET /terminal/states` / `pid terminals` buys nothing: the
    // session row already names its pane in `paneId`.
    const ownRows = panes.length > 1
    // Whole sessions, never half of one: a fold over a partial pane set could
    // report `working` for a session whose unread pane is blocked, which is the
    // failure the fold is ordered to avoid in the first place.
    if (panes.length > input.readBudget - list.reads) return list.reads
    // Only ever off a FRESH list. A cached list says nothing about a pane that
    // closed since it was taken, and pruning rows against stale ids would delete
    // a live pane's row — the same reason this is not called when `listPanes`
    // failed: a hiccup is not a closed pane.
    if (list.listed) {
      ports.forgetPaneStates({
        scope: target.scope,
        id: target.id,
        keepPaneIds: ownRows ? list.paneIds : [],
      })
    }
    const read = await readPanes({ target, panes, ownRows })
    settleSession({ target, readings: read.readings, moved: read.moved })
    return list.reads + panes.length
  }

  // Drop the cadence, fingerprint and pane-list entries of terminals that are not
  // in this pass's target set. Unbounded otherwise: sessions come and go all day
  // (270 in the roster on the machine this was written on) and a daemon that runs
  // for a week would keep a row for every one it ever saw. Attaching a browser
  // terminal also removes its session from the target set, which is the behaviour
  // we want — the WS tap owns that screen while it is attached, and on detach the
  // terminal comes back with no cadence and is therefore due at once.
  const forgetGoneTargets = (input: { readonly targets: ReadonlyArray<PollCandidate> }): void => {
    const liveKeys = new Set(
      input.targets.map((target) => pollCadenceKey({ scope: target.scope, id: target.id })),
    )
    for (const key of [...cadences.keys()]) {
      if (!liveKeys.has(key)) cadences.delete(key)
    }
    for (const key of [...fingerprints.keys()]) {
      // A pane row's fingerprint key is `<scope>:<id>#<paneId>`; the session-level
      // row's is the bare cadence key. Both belong to the target named before the
      // `#`.
      const hash = key.indexOf("#")
      if (!liveKeys.has(hash === -1 ? key : key.slice(0, hash))) fingerprints.delete(key)
    }
    const liveNames = new Set(input.targets.map((target) => target.sessionName))
    for (const name of [...paneLists.keys()]) {
      if (!liveNames.has(name)) paneLists.delete(name)
    }
  }

  const runPass = async (): Promise<void> => {
    pass += 1
    const [candidates, rawSessions] = await Promise.all([
      ports.listCandidates(),
      ports.listSessions(),
    ])
    const attachedSessionNames = ports.attachedSessionNames()
    const targets = selectPollTargets({
      candidates,
      sessions: parseSessionList(rawSessions),
      attachedSessionNames,
    })
    forgetGoneTargets({ targets })
    // Terminals whose screen is actually moving, plus every one this daemon has
    // not read yet. A quiet terminal is re-read on a doubling interval instead of
    // every pass — see PollCadence: the reads are what repaint the user's open
    // terminals, so a read that can only confirm an unchanged screen is pure cost.
    const due = selectDueTargets({
      targets,
      pass,
      cadences,
      ignoreBackoff: ports.hasScreenWaiters(),
    })
    // Sequential by design. Each read is a zellij client connecting, and fanning
    // them out would turn a machine with a dozen sessions into a connection storm
    // every interval. A session that dies mid-pass must not take the rest of the
    // pass with it, hence the per-target catch.
    //
    // The `list-sessions` above is this pass's first read and comes out of the
    // same budget, because it repaints the user's terminals exactly like the rest.
    let budget = readBudgetForPass({ watched: attachedSessionNames.length > 0 }) - 1
    let visited = 0
    for (const target of rotateTargets({ targets: due, offset: passOffset })) {
      // Stop at the first target the remaining budget cannot cover, rather than
      // walking the rest of the list to skip each one. `visited` then counts
      // exactly the targets this pass READ, which is what the next pass's offset
      // has to resume from — counting skipped ones too used to walk the cursor
      // back to 0 every pass and re-read the same head forever.
      if (budget < minReadsFor({ target })) break
      budget -= await pollOne({ target, readBudget: budget }).catch(() => 0)
      visited += 1
    }
    passOffset = advancePassOffset({ offset: passOffset, visited, total: due.length })
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
