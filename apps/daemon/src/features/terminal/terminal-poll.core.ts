// Pure decisions for the UNATTENDED-terminal state poller: which zellij
// sessions to dump, how to read zellij's own text output, and how to fold one
// dumped screen into a state transition. The spawning and the scheduling live
// in terminal-poll.io.ts.
//
// Why this exists: terminal-state.core.ts classifies bytes flowing through a
// terminal WebSocket bridge, so a `claude` or `pi` running inside a zellij
// session nobody has opened in the dashboard is never classified at all — no
// chip, and nothing for features/rules/ or POST /sessions/:id/wait to see.
// zellij will hand over that screen without a client attached, but only under
// one specific incantation, verified empirically against zellij 0.44.3 before
// a line of this module was written:
//
//   zellij --session <n> action dump-screen --pane-id terminal_0  -> the screen
//   zellij --session <n> action dump-screen                       -> EMPTY, exit 0
//
// Without `--pane-id`, `dump-screen` dumps the *focused* pane — and a session
// with zero attached clients has no focused pane, so it silently prints nothing
// and still exits 0. Passing the pane id is therefore mandatory, which is why
// `parseTerminalPaneIds` exists — and once the ids are in hand, every one of
// them is dumped rather than only the first: an agent running in a session's
// second pane used to be invisible to every screen-derived feature at once.
//
// Both client-less shapes were confirmed: a session created with `attach -b` and
// never attached (exactly how features/dispatch/pi.core.ts dispatches a detached
// pi run) and a session whose client attached and then went away (exactly what
// closing a browser terminal tab leaves behind). The dump is live, not a snapshot
// frozen at detach time — two dumps four seconds apart returned different
// screens. A second pane opened into such a session dumps just as well
// (re-verified 2026-07-29, same zellij: `action new-pane` then `dump-screen
// --pane-id terminal_1` returned that pane's own screen).
//
// This tier reuses terminal-state.core.ts's classifier verbatim: the same
// `stripAnsi`, `appendTail`, `classifyTail` and `decideTransition` the attached
// path uses, so a polled terminal and a bridged one can never disagree about
// what "working" means.

import {
  appendTail,
  type Classification,
  classifyTail,
  decideTransition,
  stripAnsi,
  type TerminalStateSlug,
  terminalPaneKeyPrefix,
} from "./terminal-state.core"

// The four terminal kinds the dashboard mounts, and the `scope` half of a
// `terminalStateKey`. Declared here (the slice's pure tier) rather than in
// terminal.routes.ts so the poller and the WS bridge share one definition of
// the vocabulary instead of two unions that can drift.
export type TerminalScope = "global" | "orchestrator" | "project" | "session"

// ---- zellij list-sessions -----------------------------------------------

export type ZellijSessionLine = {
  readonly name: string
  // zellij keeps dead sessions around as "(EXITED - attach to resurrect)".
  // There is nothing to dump from one, and on a long-lived machine they vastly
  // outnumber the live ones (558 of them on the box this was written on), so
  // the poller must never spend a subprocess on one.
  readonly exited: boolean
}

// `<name> [Created <age> ago]` with an optional ` (current)` or
// ` (EXITED - attach to resurrect)` suffix. The name is the first
// whitespace-delimited token, which is also true of `--short` output, so this
// parser reads either form.
export const parseSessionList = (raw: string): ReadonlyArray<ZellijSessionLine> => {
  const out: ZellijSessionLine[] = []
  // `--no-formatting` is what the argv builder asks for; stripping ANSI anyway
  // means a future zellij that ignores the flag degrades to correct output
  // rather than to session names with an escape sequence glued to the front.
  for (const line of stripAnsi(raw).split("\n")) {
    const trimmed = line.trim()
    const name = trimmed.split(/\s+/)[0]
    if (name === undefined || name === "") continue
    out.push({ name, exited: trimmed.includes("EXITED") })
  }
  return out
}

// ---- zellij action list-panes -------------------------------------------

// `PANE_ID  TYPE  TITLE` header, then one row per pane. TYPE is `terminal` or
// `plugin`, and dumping a plugin's screen classifies zellij's own UI rather than
// the agent. The daemon's own layouts no longer emit a plugin pane at all (see
// the block above `projectLayoutKdl` in terminal.core.ts), so today this filter
// only has to survive a plugin pane a *human* opened — which is exactly why it
// is still a filter and not an assumption about how many rows to skip.
const PANE_INDEX_RE = /_(\d+)$/

const paneIndex = (id: string): number => {
  const digits = PANE_INDEX_RE.exec(id)?.[1]
  return digits === undefined ? Number.MAX_SAFE_INTEGER : Number.parseInt(digits, 10)
}

// One `TYPE=terminal` row. The title is everything after the type column with
// its whitespace normalised to single spaces — enough to compare against a name
// the daemon minted itself (`terminal-panes.core.ts`), which is the only thing
// that reads it; a title carrying runs of spaces would not round-trip.
export type ZellijPaneRow = {
  readonly paneId: string
  readonly title: string
}

// Ascending pane index, so the layout's original content pane (`terminal_0`)
// sorts ahead of any pane the user opened later.
export const parseTerminalPaneRows = (raw: string): ReadonlyArray<ZellijPaneRow> => {
  const rows: ZellijPaneRow[] = []
  for (const line of stripAnsi(raw).split("\n")) {
    const cols = line.trim().split(/\s+/)
    // The header row's second column is the literal "TYPE", so it falls out
    // here with no special case.
    if (cols[1] !== "terminal") continue
    const paneId = cols[0]
    if (paneId === undefined || paneId === "") continue
    rows.push({ paneId, title: cols.slice(2).join(" ") })
  }
  return rows.sort((a, b) => paneIndex(a.paneId) - paneIndex(b.paneId))
}

export const parseTerminalPaneIds = (raw: string): ReadonlyArray<string> =>
  parseTerminalPaneRows(raw).map((row) => row.paneId)

// ---- how many panes, and in what order ----------------------------------

// Per-session pane budget. Every pane costs one `dump-screen` subprocess per
// pass against the user's live machine (measured: ~38ms wall each, zellij
// 0.44.3, warm), so a session someone has tiled into a pane wall must not be
// able to consume the whole pass. Four covers what a human actually builds — an
// agent, a shell, a log tail, a spare — and keeps one session's worst case at
// five spawns (`list-panes` + four dumps).
//
// This constant has a SECOND consumer, and raising it raises both: the write
// surface refuses to open a pane in a session that already holds this many
// (`decideCreatePane`'s `pane_budget` refusal in terminal-panes.core.ts). A pane
// past the cap would never be classified, so creating one would hand a caller a
// pane nothing can observe — which is the opposite of what panes are for here.
export const MAX_PANES_PER_SESSION = 4

// Whole-pass budget over EVERY zellij read the pass makes — each `list-panes` as
// well as each `dump-screen` — because the thing that has to be bounded is the
// number of times this daemon opens a connection to a zellij server, and only
// half of those are dumps.
//
// It was 64 and it counted dumps only, on the reasoning that a dump is the
// expensive call (~38ms of wall clock each) and the pass is sequential, so the
// cost was "bounded by a constant instead of by how many sessions the user
// happens to have open". Both halves of that were wrong, and the user-visible
// symptom was a browser terminal that froze for two seconds every fifteen:
//
//   - `list-panes` is one read per TARGET and was never counted, so the real
//     per-pass connection count grew with the session list after all. Measured on
//     the machine this was rewritten on: 28 targets => 1 list-sessions + 28
//     list-panes + 33 dumps = 62 zellij invocations per pass, of which the old
//     budget bounded 33.
//   - The cost that matters is not the daemon's wall clock. **Every zellij CLI
//     client that connects makes zellij repaint in full for its attached
//     clients** — measured on 0.44.3 at ~1-2 full-screen repaints per connection,
//     and it is CROSS-SESSION: reads against session A repaint an attached client
//     of unrelated session B. So one pass shipped ~110-220 full-screen repaints
//     (~400KB-1MB of ANSI) down every open terminal WebSocket inside a 2-4 second
//     window, once per interval. That is what the freeze was. Verified by
//     attaching a pty client to a session this daemon does not own and never
//     polls: it still received a repaint storm every 15.00s, and firing 21 CLI
//     reads at *other* sessions by hand reproduced one on demand.
//
// So the budget counts connections. It stays at 64 while nobody is looking: the
// repaints still happen, but with no terminal WebSocket open there is no xterm to
// parse them and no user to see the hitch, and a pass that covers the whole
// machine keeps every chip one interval fresh.
export const MAX_READS_PER_PASS = 64

// The budget while at least one terminal WebSocket is attached — i.e. exactly when
// the repaints have somewhere visible to land. Set by what a browser absorbs
// without a hitch rather than by what the daemon can spawn in an interval: 12
// reads is ~25 repaints (~85KB) over ~0.5s, against the ~110-220 (~400KB-1MB) that
// froze the terminal for two seconds.
//
// Two budgets rather than one low one because they are answers to different
// questions. The low number is what a watched terminal tolerates; the high one is
// how fresh an unwatched machine's chips are. Collapsing them would make the
// dashboard's chips four times staler for every user who does not have a terminal
// open, to fix a symptom only visible to users who do.
export const MAX_READS_PER_PASS_WATCHED = 12

// How many passes a cached pane list stays good for. A pane set changes when
// somebody opens or closes a pane, which is rare next to the poll interval, and
// re-listing every pass doubled the pass's connection count for no news. A dump
// that comes back empty invalidates the entry early (see terminal-poll.io.ts), so
// a pane that vanished costs one wasted read rather than eight passes of silence.
export const PANE_LIST_REFRESH_PASSES = 8

// Ceiling on the per-target backoff, in passes. At the default 15s interval a
// terminal whose screen has not changed for three consecutive reads settles at
// one read every 2 minutes. The ceiling bounds the staleness a chip can show, and
// 2 minutes is the same order as the bounded staleness `rotateTargets` already
// accepts on a machine with more terminals than one pass can cover.
export const MAX_BACKOFF_PASSES = 8

// `paneIds` arrives sorted by pane index (parseTerminalPaneIds), so keeping the
// first N keeps the panes the layout opened first — for a daemon-created
// session that is the content pane running the agent, and for a hand-built one
// it is the pane the user started in.
export const selectPanesToDump = (input: {
  readonly paneIds: ReadonlyArray<string>
  readonly maxPanes: number
}): ReadonlyArray<string> => (input.maxPanes <= 0 ? [] : input.paneIds.slice(0, input.maxPanes))

// ---- which sessions to poll ---------------------------------------------

// One terminal this daemon knows how to reach, with the zellij session name it
// would attach to. `sessionName` is always derived through
// `prefixedZellijSession`, so a candidate list is prefix-correct by
// construction and a second daemon's namespaced sessions can never appear in
// it.
export type PollCandidate = {
  readonly scope: TerminalScope
  readonly id: string
  readonly sessionName: string
}

// Ownership is decided by derivation, not by name shape. With the default
// empty PID_ZELLIJ_PREFIX this daemon's session names are global to the OS
// user on purpose (see config.io.ts's `zellijPrefix`), so nothing about the
// string "default" says whether the dashboard owns it. Intersecting the
// daemon's OWN candidate list with what zellij reports as live is therefore
// the only filter that is both complete and safe: a session the daemon never
// derived is never dumped, whatever it is called.
export const selectPollTargets = (input: {
  readonly candidates: ReadonlyArray<PollCandidate>
  readonly sessions: ReadonlyArray<ZellijSessionLine>
  // Zellij session names with a live terminal WebSocket right now. Skipped:
  // that bridge already classifies the same screen byte-accurately on a 400ms
  // throttle, and two writers for one terminal would just fight. Matched by
  // session NAME rather than by `scope:id` because one zellij session can be
  // reached under more than one URL id (a session exposed under a
  // `daemonShort` alias), and the name is what both sides agree on.
  readonly attachedSessionNames: ReadonlyArray<string>
}): ReadonlyArray<PollCandidate> => {
  const live = new Set(input.sessions.filter((s) => !s.exited).map((s) => s.name))
  const attached = new Set(input.attachedSessionNames)
  const claimed = new Set<string>()
  const targets: PollCandidate[] = []
  for (const candidate of input.candidates) {
    const { sessionName } = candidate
    if (!live.has(sessionName) || attached.has(sessionName) || claimed.has(sessionName)) continue
    claimed.add(sessionName)
    targets.push(candidate)
  }
  return targets
}

// ---- rotating the pass so the budget is not a permanent blind spot ------

// A pass that always started at the head of the candidate list and stopped at
// MAX_READS_PER_PASS would make everything past the cut permanently invisible —
// the same "silently reports on some panes and calls it the truth" bug that
// per-pane classification exists to remove, just moved from panes to sessions.
// Starting where the last pass stopped turns that into bounded staleness
// instead: every terminal is still reached, just every k-th pass.
export const rotateTargets = (input: {
  readonly targets: ReadonlyArray<PollCandidate>
  readonly offset: number
}): ReadonlyArray<PollCandidate> => {
  const total = input.targets.length
  if (total === 0) return []
  // A negative or non-finite offset degrades to "start at the head" rather than
  // producing holes or duplicating a target inside one pass.
  const start = Number.isFinite(input.offset) && input.offset > 0 ? input.offset % total : 0
  if (start === 0) return input.targets
  return [...input.targets.slice(start), ...input.targets.slice(0, start)]
}

// Where the next pass starts. A pass that covered everything leaves the cursor
// at 0, so a machine small enough to fit inside the budget never rotates at all
// and its map keys keep a stable order.
export const advancePassOffset = (input: {
  readonly offset: number
  readonly visited: number
  readonly total: number
}): number => (input.total <= 0 ? 0 : (input.offset + input.visited) % input.total)

// ---- how often one target is worth re-reading ---------------------------

// Rotation bounds what a pass costs; this bounds how often a pass has anything
// worth spending. Every read repaints the user's open terminals (see
// MAX_READS_PER_PASS), so re-reading a screen that is not moving is the one cost
// here with no benefit at all — and on a real machine most terminals are exactly
// that: a shell sitting at a prompt, or an agent that finished hours ago.
//
// The signal is whether the SCREEN moved, not whether the classification did.
// Classification is the wrong trigger in both directions: a working agent whose
// spinner churns every frame stays `working` pass after pass (so a
// classification-driven backoff would starve the busiest terminal, the one
// somebody is most likely waiting on), while a `blocked` prompt is byte-identical
// until it is answered (so it would look fresh forever while nothing happened).
// A fingerprint of the dumped text answers "is anything happening here" directly.
export type PollCadence = {
  // Consecutive reads that found the same screen as the read before.
  readonly quietPasses: number
  // The pass number this target becomes worth reading again.
  readonly nextDuePass: number
}

// 1, 2, 4, 8, 8, 8 … — doubling, capped. The first quiet read only halves the
// rate rather than dropping straight to the ceiling, so a terminal that pauses
// for one interval mid-run does not go stale for two minutes.
export const backoffPasses = (input: { readonly quietPasses: number }): number => {
  const quiet = Number.isFinite(input.quietPasses) ? Math.max(0, Math.trunc(input.quietPasses)) : 0
  if (quiet <= 0) return 1
  return Math.min(2 ** quiet, MAX_BACKOFF_PASSES)
}

// A target with no cadence yet has never been read, and a new terminal must be
// classified on the pass that finds it — so "unknown" reads as due, never as
// backed off.
export const isTargetDue = (input: {
  readonly cadence: PollCadence | undefined
  readonly pass: number
}): boolean => input.cadence === undefined || input.pass >= input.cadence.nextDuePass

// What the cadence becomes after a read. `changed` is "the screen moved, or the
// classification did" — either one means this terminal is live and worth the
// next pass.
export const advanceCadence = (input: {
  readonly cadence: PollCadence | undefined
  readonly pass: number
  readonly changed: boolean
}): PollCadence => {
  const quietPasses = input.changed ? 0 : (input.cadence?.quietPasses ?? 0) + 1
  return { quietPasses, nextDuePass: input.pass + backoffPasses({ quietPasses }) }
}

// The targets this pass should actually spend reads on, in the order given.
//
// `ignoreBackoff` is the escape hatch and it exists for one caller: an output
// wait (`pid wait --until-output`, `--via screen`) resolves off these passes and
// nothing else, so while one is pending every target has to be read at the full
// interval or the wait silently gains up to MAX_BACKOFF_PASSES of latency.
export const selectDueTargets = (input: {
  readonly targets: ReadonlyArray<PollCandidate>
  readonly pass: number
  readonly cadences: ReadonlyMap<string, PollCadence>
  readonly ignoreBackoff: boolean
}): ReadonlyArray<PollCandidate> => {
  if (input.ignoreBackoff) return input.targets
  return input.targets.filter((target) =>
    isTargetDue({
      cadence: input.cadences.get(pollCadenceKey({ scope: target.scope, id: target.id })),
      pass: input.pass,
    }),
  )
}

// `<scope>:<id>` — the same shape terminal-state.core.ts keys its state map by,
// so a cadence and a state for one terminal are looked up under one string and
// cannot drift apart on how they were spelled.
export const pollCadenceKey = (input: { readonly scope: string; readonly id: string }): string =>
  `${input.scope}:${input.id}`

// Cheap content hash of one screen dump: djb2 over the text plus its length.
// A fingerprint rather than the text itself for two reasons — a per-terminal copy
// of every screen is real memory (~4KB x every terminal the daemon can see), and
// screen text is the one thing this slice is careful never to retain or forward
// beyond the observer that asked for it (see terminal.routes.ts's
// `subscribeTerminalScreens`). Collisions cost one skipped read, not correctness:
// the next changed frame lands on a different hash.
export const screenFingerprint = (input: { readonly text: string }): string => {
  let hash = 5381
  for (let i = 0; i < input.text.length; i += 1) {
    hash = (hash * 33 + input.text.charCodeAt(i)) | 0
  }
  return `${input.text.length}:${hash}`
}

// ---- is a cached pane list still good? ----------------------------------

export const isPaneListFresh = (input: {
  readonly listedAtPass: number | undefined
  readonly pass: number
}): boolean =>
  input.listedAtPass !== undefined && input.pass - input.listedAtPass < PANE_LIST_REFRESH_PASSES

// ---- how many reads this pass may spend ---------------------------------

// See MAX_READS_PER_PASS: the cap tightens exactly while a terminal WebSocket is
// open, because that is when a zellij repaint has a browser to land in.
export const readBudgetForPass = (input: { readonly watched: boolean }): number =>
  input.watched ? MAX_READS_PER_PASS_WATCHED : MAX_READS_PER_PASS

// ---- folding several panes into one session-level reading ---------------

// One pane's classification, tagged with the pane it came from.
export type PaneReading = {
  readonly paneId: string
  readonly state: TerminalStateSlug
  readonly matcher: string | undefined
  readonly evidence: string | undefined
}

// Attention priority, and the whole session-level decision lives here.
//
// Every screen-derived feature reads the session-level row: the dashboard chip,
// `wait --via screen`, `GET /sessions/:id/explain`, and features/rules. When two
// panes of one session disagree, that row can only say one thing, and the two
// candidate answers fail differently:
//
//   - Reporting `working` while one pane sits at an unanswered prompt hides a
//     stall that NOTHING will clear on its own. The wait built to notice it
//     never fires, the rule built to answer it never runs, and the cost is
//     unbounded time — the session simply never finishes.
//   - Reporting `blocked` while two other panes generate costs one wasted look.
//     The next pass corrects it the moment the prompt is answered, and the per-
//     pane rows sit right beside it in the same map (`<scope>:<id>#<paneId>`),
//     so the working panes are not hidden from anyone who asks.
//
// The costs are asymmetric, so the aggregate is deliberately the most
// attention-worthy pane rather than a majority or the first pane: blocked >
// working > idle > unknown. `working` outranks `idle` for the same reason one
// step down — an idle session-level row is what `wait --until idle --via screen`
// settles on, so a resting shell beside a generating agent would report a
// session as finished when it is mid-run. `unknown` ranks last because it is the
// absence of evidence (no matcher fired), not a state.
//
// The row is a CITATION, not a summary: the winner's own matcher, evidence and
// pane id are carried through verbatim, so "session:ab12 is blocked" always
// names a real pane whose real screen said so, and never a state no pane was in.
const ATTENTION_PRIORITY: Readonly<Record<TerminalStateSlug, number>> = {
  blocked: 3,
  working: 2,
  idle: 1,
  unknown: 0,
}

// Ties go to the earliest pane in the input, which parseTerminalPaneIds ordered
// by pane index — so an unchanging screen yields an unchanging row instead of
// flapping between two panes that agree.
export const foldPaneReadings = (input: {
  readonly panes: ReadonlyArray<PaneReading>
}): PaneReading | undefined => {
  let winner: PaneReading | undefined
  for (const pane of input.panes) {
    if (winner === undefined) {
      winner = pane
      continue
    }
    if (ATTENTION_PRIORITY[pane.state] > ATTENTION_PRIORITY[winner.state]) winner = pane
  }
  return winner
}

// ---- pane rows whose pane is gone --------------------------------------

// Which stored keys belong to this terminal's panes but not to a pane that
// should still have a row. Pure so the route can hand it the map's keys and
// delete what comes back, and so "never the session-level row" is a property a
// test pins rather than a comment.
export const stalePaneKeys = (input: {
  readonly keys: ReadonlyArray<string>
  readonly scope: string
  readonly id: string
  readonly keepPaneIds: ReadonlyArray<string>
}): ReadonlyArray<string> => {
  const prefix = terminalPaneKeyPrefix({ scope: input.scope, id: input.id })
  const keep = new Set(input.keepPaneIds.map((paneId) => `${prefix}${paneId}`))
  return input.keys.filter((key) => key.startsWith(prefix) && !keep.has(key))
}

// ---- folding one dump into a transition ---------------------------------

export type ScreenFold = {
  readonly classification: Classification
  readonly publish: boolean
  // The bounded screen, ANSI stripped: what the pane actually reads as. Handed
  // to `wait --until-output` observers, which need to match a pattern against
  // the whole screen rather than against a classification of it.
  readonly text: string
}

export const foldScreenDump = (input: {
  readonly dump: string
  readonly prior: TerminalStateSlug | undefined
  readonly maxChars: number
}): ScreenFold => {
  // A dump is a full SNAPSHOT of the viewport, not the incremental chunk the
  // WS tap receives, so it REPLACES the tail instead of being appended to it.
  // Appending would keep every previous screen inside the window, and because
  // `classifyTail` is first-match-wins over the whole tail, a single stale
  // "Do you want to proceed?" would outrank the live spinner for as long as the
  // daemon ran — the terminal would read `blocked` forever after one answered
  // prompt. Passing an empty prior tail reuses `appendTail` unchanged for the
  // one thing still needed here: keeping the LAST maxChars, i.e. the bottom of
  // the screen, which is where every status line and dialog lives.
  const tail = appendTail({ tail: "", chunk: input.dump, maxChars: input.maxChars })
  const classification = classifyTail({ tail })
  return {
    classification,
    publish: decideTransition({ prior: input.prior, next: classification }).publish,
    // `classifyTail` strips internally and does not hand the result back, so
    // this strips the same bounded tail a second time rather than reaching into
    // terminal-state.core.ts to split its classifier apart. Two regex passes
    // over at most `maxChars` per terminal per poll interval is not a cost worth
    // destabilising that module's matcher table for.
    text: stripAnsi(tail),
  }
}

// ---- argv ---------------------------------------------------------------

// Built here rather than inline in the io tier for the same reason
// `zellijKillSessionArgv` lives in terminal.core.ts: the exact flags are the
// interesting part, and a test can pin them without spawning anything.

export const zellijListSessionsArgv = (): ReadonlyArray<string> => [
  "zellij",
  "list-sessions",
  "--no-formatting",
]

export const zellijListPanesArgv = (input: {
  readonly sessionName: string
}): ReadonlyArray<string> => ["zellij", "--session", input.sessionName, "action", "list-panes"]

// `--pane-id` is not an optimisation — see this module's header. Without it a
// client-less dump returns an empty string and exit 0.
export const zellijDumpScreenArgv = (input: {
  readonly sessionName: string
  readonly paneId: string
}): ReadonlyArray<string> => [
  "zellij",
  "--session",
  input.sessionName,
  "action",
  "dump-screen",
  "--pane-id",
  input.paneId,
]
