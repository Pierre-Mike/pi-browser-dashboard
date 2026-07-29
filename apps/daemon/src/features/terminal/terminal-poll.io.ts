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
  foldScreenDump,
  type PollCandidate,
  parseSessionList,
  parseTerminalPaneIds,
  selectPollTargets,
  type TerminalScope,
  zellijDumpScreenArgv,
  zellijListPanesArgv,
  zellijListSessionsArgv,
} from "./terminal-poll.core"
import type { TerminalStateSlug } from "./terminal-state.core"

export type PolledState = {
  readonly scope: TerminalScope
  readonly id: string
  readonly state: TerminalStateSlug
  readonly matcher: string | undefined
  readonly evidence: string | undefined
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
  readonly now: () => number
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

  const pollOne = async (target: PollCandidate): Promise<void> => {
    const paneId = parseTerminalPaneIds(
      await ports.listPanes({ sessionName: target.sessionName }),
    )[0]
    if (paneId === undefined) return
    const dump = await ports.dumpScreen({ sessionName: target.sessionName, paneId })
    // An empty dump is not evidence of anything: a pane that has produced no
    // output yet, or a session that died between list-sessions and this call,
    // both look like this. Staying silent leaves the last known state (or no
    // state) in place instead of overwriting it with a guess.
    if (dump.trim() === "") return
    const key = `${target.scope}:${target.id}`
    const folded = foldScreenDump({
      dump,
      prior: ports.priorState({ key }),
      maxChars: tailMaxChars,
    })
    if (!folded.publish) return
    ports.publish({
      scope: target.scope,
      id: target.id,
      state: folded.classification.state,
      matcher: folded.classification.matcher,
      evidence: folded.classification.evidence,
    })
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
    // Sequential by design. Each target costs two subprocess spawns, and
    // fanning them out would turn a machine with a dozen sessions into a
    // spawn storm every interval. A session that dies mid-pass must not take
    // the rest of the pass with it, hence the per-target catch.
    for (const target of targets) {
      await pollOne(target).catch(() => undefined)
    }
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

  return { start, stop, tick, refreshIfStale }
}
