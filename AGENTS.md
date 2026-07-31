# AGENTS.md — pi-browser-dashboard

## Goal

A browser front-end to Claude Code's `claude agents` background sessions. Same supervisor, same worktrees, same auto-cleanup — different surface: a grid of cards reachable from any device, with richer permission and artifact rendering than a terminal can manage.

## Architecture

Daemon is a thin file-watcher + child-process wrapper over the existing Claude Code supervisor. Sessions are spawned with `claude --bg`, observed via `~/.claude/daemon/roster.json` and `~/.claude/jobs/<id>/state.json`, controlled via `claude stop|respawn|rm`. The supervisor owns processes, worktrees, summarization, restart-on-attach. We never touch them.

```
+----- Browser (Vite+React+TanStack) -----+
|  GRID OF CARDS    |  DISPATCH BAR       |
+---------|---------+---------|-----------+
          | SSE down          | POST up
          v                   v
+----- Bun daemon (thin) -----------------+
|  features/dispatch     shell-out spawn  |
|  features/roster       watch roster.json|
|  features/jobs         watch state.json |
|  features/transcripts  read JSONL drill-in
|  features/sessions     stop/respawn/rm  |
|  platform/sse-bus                       |
|  platform/shell.repo                    |
|  platform/fswatch.repo                  |
+----------|------------------------------+
           v
  Claude Code supervisor (owns everything)
     ├── ~/.claude/daemon/roster.json
     ├── ~/.claude/jobs/<id>/state.json
     ├── ~/.claude/projects/<encoded-cwd>/<id>.jsonl
     └── .claude/worktrees/<id>/   (auto-managed)
```

Three flows:
- **Down (SSE)**: `roster.json` change → roster delta; `state.json` change → per-session delta; fan out as SSE events.
- **Up (POST)**: dispatch → `claude --bg`; kill → `claude stop`; respawn → `claude respawn`; delete → `claude rm`.
- **Side**: drill-in pulls transcript via `getSessionMessages()` from the Agent SDK helpers (or direct JSONL read).

## Repo skeleton

```
pi-browser-dashboard/
├── apps/
│   ├── daemon/        # Bun + Hono + Effect-TS (thin)
│   ├── web/           # Vite + React SPA
│   ├── cli/           # `pid-dashboard` single-binary distribution
│   └── e2e/           # Playwright suite
├── scripts/           # the harness: gate scripts + their co-located tests
├── biome-plugins/     # GritQL rules the biome config loads
├── .fallow-baselines/ # committed complexity/duplication baselines
├── biome.json
├── lefthook.yml
├── stryker.config.json
├── tsconfig.base.json
├── package.json       # bun workspaces, no Turborepo
├── CLAUDE.md          # the engineering canon (shared verbatim below)
├── AGENTS.md
└── .gitignore
```

- Package names: `@pid/daemon`, `@pid/web`, `pid-dashboard` (`apps/cli`), `@pid/e2e`.
- Every `apps/*` workspace carries a `tsconfig.json`; `scripts/typecheck.ts`
  discovers them and treats a missing one as an error, not a skip.
- Daemon exports `AppType` via `"exports": { "./types" }`; web imports it for `hc<AppType>` client.
- `tsconfig.base.json` extended by both apps; `strict: true`, `noUncheckedIndexedAccess: true`.
- `AGENTS.md` at root, `CLAUDE.md` per app.
- No `dist/`, no `node_modules` in git.

## Stack lock-ins

| Layer       | Choice                                                                                                                                                |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repo        | bun workspaces, no Turborepo                                                                                                                          |
| Tooling     | Biome (`biome ci` in CI), Lefthook (`stage_fixed: true`)                                                                                              |
| Daemon      | Bun + Hono + Effect-TS, FCIS suffix-discipline (`*.core.ts` / `*.io.ts` / `*.routes.ts`), `hc<AppType>` typed RPC                                   |
| Web         | Vite + React + TanStack Router (file-based) + TanStack Query + SSE patcher; Zustand only if needed; Tailwind                                          |
| API         | `POST /dispatch`, `POST /sessions/:id/{stop,respawn,rm,rename,tag}`; `GET /events` (single SSE); `@effect/schema` both ends                           |
| Persistence | None in daemon. Supervisor + SDK FS own all state                                                                                                     |

## Backend feature slices

```
apps/daemon/src/
├── features/
│   ├── dispatch/      # claude --bg shell-out + id parse from stdout
│   ├── roster/        # watch ~/.claude/daemon/roster.json
│   ├── jobs/          # per-session ~/.claude/jobs/<id>/state.json watcher pool
│   ├── transcripts/   # JSONL read on drill-in (uses Agent SDK helpers)
│   └── sessions/      # routes: stop / respawn / rm / rename / tag
├── platform/
│   ├── shell.io.ts          # spawn/wait/collect shell commands (Effect-wrapped)
│   ├── fswatch.io.ts        # Bun.watch wrapper, debounced
│   ├── sse-bus.ts
│   ├── effect-handler.ts      # Effect runtime adapter
│   └── route-types.ts         # RouteModule<TApp>
├── api.ts             # thin registry — .route() mounts only
└── main.ts            # Bun.serve + Layer composition
```

Control flow:

```
dispatch.routes ──spawn──> shell.repo
                              │ claude --bg [--agent ...] [--permission-mode ...] "<prompt>"
                              │ stdout: "backgrounded · <id>"
                              v
                          (session now exists; roster watcher picks it up)

roster.json change ──> roster.repo ──> sse-bus  ──> GET /events
                                        │
                                        v
                                  attach new state.json watchers,
                                  detach watchers for removed ids

state.json change  ──> jobs.repo   ──> sse-bus  ──> GET /events
(per-session watcher)
```

Rules:
- `*.core.ts` = pure; no `new Date()`, no `crypto.randomUUID()`, no `Math.random()` — pass in.
- `*.io.ts` = Effect services behind `Context.Tag`. `shell.repo` and `fswatch.repo` encapsulate all side effects.
- `*.routes.ts` = Hono routes + `Effect.gen` orchestration.
- `Effect.runPromise` only in `*.routes.ts` and `main.ts`.
- No cross-feature imports — compose at `api.ts` or via `platform/sse-bus.ts` types.
- Co-located tests: `foo.routes.test.ts` exercises `testApp` with a `ShellTest` layer that fakes `claude --bg` output.

## API surface

```
Web                              Daemon
────────────                     ─────────────
hc<AppType>  ──POST──>  /dispatch
                        /sessions/:id/{stop,respawn,rm,rename,tag}
                        /sessions/:id/send   (raw keys string; optional `wait` → submit-and-wait)
                        /sessions/:id/keys   (named key vocabulary; optional `wait`)
                        /sessions/:id/wait   (server-owned wait on session state,
                                              `via` supervisor | screen | either)
             ──GET───>  /sessions, /sessions/:id, /sessions/:id/transcript
                        /sessions/:id/explain  (state provenance: source, staleness, why,
                                                + the screen's own reading and whether
                                                  it contradicts the supervisor;
                                                  claude AND pi shorts)
                        /terminal/states  (current agent-state per known terminal,
                                           attached WS or polled screen dump)
                        /sessions/:id/brainstorms  (drawings in the session's worktree)
             ──SSE───<  /events  (live deltas, single stream)
```

SSE event union (exported from daemon, consumed in web):

```
roster.changed       ← roster.json changed; payload = full new id list
session.state        ← state.json changed; payload = parsed state
session.created      ← id appeared in roster (derived from roster.changed)
session.removed      ← id left roster   (derived from roster.changed)
terminal.state       ← a terminal's classified agent state changed; payload =
                        { scope, id, state, matcher, evidence,
                          screenReadAt, stateChangedAt }
fleet.run            ← a fleet run or one of its steps changed status; payload =
                        the run summary (see "Fleet recipes" below)
rules.fired          ← a rule matched (on either reading — session.state or
                        terminal.state) and either fired or was suppressed;
                        payload = { _tag, rule, short, action, reason?, at }
                        (see "State-change rules" below)
notification         ← a `notify` rule action's own message, for a future
                        web toast/notifier; payload = { short, rule, message,
                        at }
```

- One SSE stream, server fans roster + per-session deltas.
- Heartbeat every 15s; client reconnects with `Last-Event-ID`.
- TanStack Query owns server state. SSE patches `queryClient.setQueryData`.
- POST handlers return the updated entity; SSE remains the truth.
- `GET /agent-skill.md` — not part of the web RPC surface above; a
  markdown instruction file, compiled into the daemon binary, teaching an
  *agent* (not the SPA) this daemon's own control surface: the `pid` CLI, the
  named-key vocabulary, wait semantics, `explain`, and the fan-out/join
  `spawn` recipe. Guarded against drift from the real vocabulary/constants/
  routes by `apps/daemon/src/platform/agent-skill.test.ts`.
- `GET /projects/:id/fleets` — a project's `.pid/fleet.json` recipes, parsed,
  validated and grouped into dependency waves (see "Fleet recipes" below).
- `POST /projects/:id/fleets/:name/run` — dry-run or execute a recipe.
  `GET /projects/:id/fleet-runs[/:runId]` — run status. Daemon + CLI only —
  no web UI yet (see "Fleet recipes" below).
- `GET /rules`, `POST /rules/pause`, `POST /rules/preview` — automation rules on
  either reading of a session (the supervisor's `session.state` or the screen
  classifier's `terminal.state`), off by default. Daemon + CLI only — no web UI
  yet (see "State-change rules" below).

### Server-owned waits (`features/sessions/sessions-wait.*`)

`POST /sessions/:id/wait` and the optional `wait` object on `POST
/sessions/:id/send` let a caller block on a session reaching one of a set of
states instead of polling `GET /sessions` — the daemon already publishes
`session.state` / `session.removed` / `terminal.state` on the SSE bus, so the
wait is event-driven, not a poll loop.

- Body: `{ until: SessionStateSlug[], timeoutMs?, via?, untilOutput? }` —
  `timeoutMs` defaults to 30s, capped at 10 minutes, `via` defaults to
  `"supervisor"`. `until` must be non-empty when present, and a request needs
  `until` or `untilOutput`; neither is a 400.
- `POST /:id/wait` responses: `200 { ok: true, short, state, via, waitedMs }`
  (satisfied), `200 { ok: false, reason: "timeout" | "occupant_changed" |
  "removed", short, waitedMs? }`, or `404 { error: "not_found", short }`.
- `POST /:id/send` with a `wait` object sends the keys first, then waits, and
  embeds the same outcome payload under `wait` in its `{ ok: true, short }`
  response; without `wait` the response is unchanged. A malformed `wait`
  object is a 400 before any keys are sent.
- Every wait is **pinned to the occupant**: it captures the session's
  `sessionId` before subscribing (or the caller-supplied `pinnedSessionId` for
  send-with-wait, closing the race between the two calls), and reports
  `occupant_changed` rather than a false `Satisfied` if a different
  `sessionId` takes over the same `short` while waiting.

#### `via`: which observation settles the wait

A session has two independent readings, and they disagree in exactly the case
that matters. `state.json` is what the supervisor last wrote; the screen
classification (`features/terminal/terminal-state.*`, polled every 15s for
every unattended pane) is what the terminal actually shows. Session `4d76edc1`
sat at `working` in `state.json` for 24 hours while its pane showed an empty
prompt — no supervisor-sourced wait could ever have noticed, which is why
`via` exists.

- `"supervisor"` (default) — `session.state` only. Every caller written before
  this field existed keeps precisely its old semantics.
- `"screen"` — `terminal.state` only, `scope === "session"` records only.
- `"either"` — whichever arrives first.
- `Satisfied` carries `via: "supervisor" | "screen"` (never `"either"` — that
  is a request, not an answer), threaded through `WaitOutcome` onto the wire.
  A screen-satisfied wait is the weaker claim of the two: the pane looks like
  that state, the agent did not report it.
- The screen vocabulary is a **subset**: `working` → `working`, `blocked` →
  `blocked`, `idle` → `idle`, and `unknown` maps to nothing at all, so it can
  never satisfy a wait. There is no screen evidence for `done` / `failed` /
  `stopped` / `needs_input`, so a `via: "screen"` wait naming only those times
  out by construction.
- `decideInitial` consults the **current** screen too, not just later
  transitions: a pane already `blocked` when the wait starts satisfies
  immediately rather than hanging for the full timeout.
- **...and only when that stored reading is fresh** (`SCREEN_READING_MAX_AGE_MS`,
  60s — four default poll intervals). The initial check reads `screenReadAt`, the
  time the pane was last *read*, never `stateChangedAt`: a pane resting all
  morning is re-read every pass, so judging it on dwell would discard current
  evidence. Past the ceiling — or with a `screenReadAt` that will not parse, which
  counts as not fresh — the reading is dropped and the wait stays `Pending`.
  - Why this matters: before the ceiling, a daemon with `PID_TERMINAL_POLL_MS=0`
    (or one whose timers had died, which has happened here) would answer
    `reached "idle" via screen` from a record nobody had refreshed since boot. An
    agent that blocks on the screen and is handed a two-hour-old answer is worse
    off than one that timed out, **because it proceeds**.
  - Stale is not refused, it is unsatisfied: the wait keeps listening until its
    timeout, because with a poller armed a fresh reading may be one pass away.
    So a `timeout` from a screen wait means "nothing current said so", never "it
    never will". There is deliberately no new outcome tag for it — the diagnosis
    lives in `pid explain`, which prints both ages of the reading.
  - **One last look before giving up.** On timeout — and only on timeout, never
    over an `OccupantChanged`/`Removed`/matched outcome — the shell re-reads the
    stored classification and applies the same `screenLook` the initial check
    used. This closes a gap the ceiling opens by itself: a poller pass that
    re-reads a pane and finds the SAME classification publishes nothing (that is
    `markTerminalScreenRead`, and it is silent on purpose), so a wait that
    declined a stale reading and then watched that very reading be *confirmed*
    would have nothing to hear on the bus and would time out on a screen that had
    just been read and did match. The last look is one map read, no I/O, and it
    reports the real elapsed `waitedMs` rather than 0 — "confirmed at the end of
    the wait" is a different claim from "already true when it started". It is
    screen-only for the same reason the ceiling exists: `current` (the
    supervisor's state) is a snapshot from when the wait STARTED, so satisfying
    from it at the end would answer off data as old as the wait itself.
  - A wait that admits screen evidence (`via` screen/either, or `untilOutput`)
    first calls the poller's `refreshIfStale` through the `terminalScreens` port,
    so the reading it judges is as current as the daemon can cheaply make it. That
    call is bounded by the poller: inert when polling is disabled, inert when the
    last pass is younger than the interval, and overlapping calls share the single
    in-flight pass — N concurrent waits cost at most one pass, never N. A
    supervisor-only wait never makes the call at all.
  - A classification arriving on the bus **during** the wait carries no age and no
    ceiling: it was published the instant the screen changed, so it is fresh by
    construction. Only the stored reading is bounded.
  - `via: "screen"` with polling off is still NOT refused up front, unlike
    `untilOutput`'s 409 `screen_polling_disabled`, and the asymmetry is
    deliberate: `untilOutput` resolves off poller passes and nothing else
    (`noteScreen` has exactly one caller), whereas a `terminal.state` event has a
    second, independent producer — the WS classifier tap, which keeps any pane a
    browser is attached to current whatever the poller is doing. Refusing would
    claim impossibility that does not hold.
- `session.removed` settles `Removed` under every `via` — a deleted session is
  not an observation about state, it is the end of the thing observed.
- **How the screen reaches this slice.** The terminal slice publishes one door,
  `readTerminalState({ scope, id })` over its own `terminalStates` map;
  `api.ts` passes it as an injected port into `buildSessionsApp` and into the
  fleet run ports. `sessions-wait.core.ts` only ever sees plain data (an
  `InitialScreenReading | undefined` — the slug plus how long ago the pane was
  read, so the ceiling above is a pure decision), and neither the core nor
  `sessions-wait.io.ts` imports the terminal slice. It is a port rather than a
  `Context.Tag` for a concrete reason: `terminal.routes.ts` imports
  `platform/runtime.ts`, so a Layer dependency would close an import cycle
  through the very runtime that provides it.

#### `untilOutput`: wait for text on the screen

herdr's `pane wait-output`, for the things that have no state slug — a specific
prompt, a test summary, a banner an agent prints itself.

- `untilOutput: "text"` (substring anywhere) or
  `untilOutput: { text, anchor?: "anywhere" | "line-start" | "line-end" | "line" }`.
  Anchored forms compare against the **trimmed** line, because a real dump pads
  rows to the viewport width and the empty prompt line with U+00A0.
- **Literal only — no regex, deliberately.** A caller-supplied regex, evaluated
  in the daemon's own event path against up to `tailMaxChars` of output from an
  unauthenticated local endpoint, is a ReDoS surface: compiling once bounds the
  compile, not the backtracking, and JS gives no way to time-bound a match. The
  text is capped at `OUTPUT_PATTERN_MAX_CHARS` (200) and `anchor` covers what a
  regex was wanted for here. Do not add regex support without a real guard.
- Independent of `via`, which governs how *state* is read. Gating a pattern on
  `via` would make `{ untilOutput, via: "supervisor" }` unsatisfiable — a trap,
  not a safeguard.
- Combining `until` and `untilOutput` is allowed: first to fire wins, the same
  composition rule as `via: "either"`. Outcomes are distinguishable —
  `Satisfied` carries `state`/`via`, `OutputMatched` carries `matched` (the line
  the pattern appeared on) and no state.
- **Screen text never touches `sseBus`.** That bus is what
  `features/events/events.routes.ts` forwards to every connected browser, so
  publishing pane text there would ship the contents of every terminal to every
  SSE client as a side effect of a wait feature. Instead `terminal.routes.ts`
  exposes an in-process channel, `subscribeTerminalScreens`, fed by a new
  `noteScreen` poller port that fires on **every** successful dump — not behind
  the publish-on-change gate, because a pattern routinely appears while the
  classification is unchanged. `api.ts` injects `{ enabled, subscribe }` into the
  sessions routes as one port.
- Because it resolves off poller passes and nothing else, worst-case latency is
  one poll interval, only text still on screen can match (it watches a pane, it
  does not tail a log), and a daemon with polling disabled answers
  `409 { error: "screen_polling_disabled" }` at request time rather than letting
  the wait time out — `TerminalPollerApi.isEnabled()` is what the route reads.

### Named key vocabulary (`features/sessions/sessions-keys.*`)

`POST /sessions/:id/keys` answers a permission prompt or an `AskUserQuestion`
menu by name — `escape`, `enter`, `tab`, `shift-tab`, `up`, `down`, `left`,
`right`, `home`, `end`, `page-up`, `page-down`, `backspace`, `delete`,
`space` — instead of a caller hand-encoding terminal control bytes into
`POST /:id/send`'s raw `keys` string. `POST /:id/send` is unchanged and stays
the escape hatch for anything not named here.

- Body: `{ sequence: KeyStep[], wait? }`, where a step is either
  `{ named, repeat? }` (a vocabulary entry, `repeat` an integer 1–32) or
  `{ text }` (literal input — no control characters; use `named` for those).
  `sequence` is a non-empty array of at most 32 steps; the resolved bytes are
  capped at 4096, the same cap `POST /:id/send` enforces. `wait` is the same
  `{ until, timeoutMs? }` shape as above and gets the same pinned-occupant
  send-then-wait treatment.
- `ctrl-z` and `ctrl-c` are deliberately not in the vocabulary — both are
  rejected as unknown names. `ctrl-z` is the byte the daemon's own attach pool
  uses to evict an idle `claude attach` (see `shell.io.ts`); `ctrl-c` quits the
  TUI outright, where `POST /:id/stop` is the supported way to end a session.
  Naming either would let a caller reach past the daemon's own bookkeeping.
- Response: `200 { ok: true, short, resolved, bytes }` — `resolved` is a
  human-readable trail (e.g. `["down", "down", "enter"]` for a `repeat: 2`
  step followed by `enter`; a `text` step appears quoted, e.g. `"hello"`) and
  `bytes` is the resolved byte count — plus a `wait` field with the same
  outcome shape as `POST /:id/wait` when a wait was requested. A malformed
  `sequence` or `wait` is a 400 before anything is sent.
- Example — answer a two-down-then-select menu and confirm the session
  resumed: `{ sequence: [{ named: "down", repeat: 2 }, { named: "enter" }],
  wait: { until: ["working", "idle"] } }`.

### Terminal agent-state detection (`features/terminal/terminal-state.*`)

The session roster only knows about work the supervisor or the daemon itself
spawned. A `claude` (or `pi`) the user starts by hand inside the global,
project, orchestrator, or session-drill-in terminal is otherwise invisible —
no chip, no notification. Since the daemon already pipes that terminal's
bytes to the browser over the existing WS bridge (`terminal.routes.ts`), it
taps the same bytes to classify what the agent is doing, the way `herdr`
reads any terminal's screen instead of requiring an integration: a pure
regex table (`MATCHERS` in `terminal-state.core.ts`) matches known
status-line and dialog shapes — Claude Code's rotating status line
(`<Gerund>…` plus a live elapsed-time reading) while generating, a dispatched
tool's pending marker mid-tool-call, a finished turn's `<PastVerb> for <N>s`,
a permission dialog's question line *together with its option list* while
blocked on a permission decision, the workspace-trust dialog's own option line
while blocked before the session has started at all; pi's braille spinner plus
its working literal while generating, and pi's own footer reading while resting
— against a per-connection rolling tail, stripped of ANSI first. States:
`working`, `blocked`, `idle`, `unknown` — `unknown` is the honest default when
nothing matches, not a guessed `idle`.

**Every shape above is described here with placeholders, deliberately.** These
matchers read screens, and this file gets displayed on screens: paste a complete
rendered line into the docs and the docs start classifying as an agent at work.
That is not hypothetical — it is how the self-reference defect below was found,
twice. Verbatim captures belong in the test fixtures, which is the one place a
matchable render is correct.

The `blocked` rows are the load-bearing ones (`wait --until blocked`, the
auto-answer rules) and they were rewritten on 2026-07-29 against two live
`dump-screen` captures of real dialogs, which corrected two things the earlier
binary-strings evidence could not:

- **The question is not one fixed sentence.** A Bash approval asks
  `Do you want to proceed?`; a Write approval asks
  `Do you want to create <file>?` and never prints "proceed". Matching the one
  sentence read a genuinely blocked live screen as `unknown`. The row now
  matches `Do you want to …?` as a shape.
- **A question line alone is a substring anyone can print — including us.** The
  old row was self-referential: any terminal *displaying* the matcher table, a
  diff of it, or this paragraph classified as `blocked`. Confirmed live on a
  session that only ran `sed` over those two files. The question now counts only
  when the dialog's own option list follows it (`1.` is always the first item,
  wherever the `❯` cursor sits), which a source listing does not have.

The gap between question and options is whitespace-only but **not reliably a
newline**: a dump separates them with `\n`, while the attached WS path carries
zellij's redraw, which jumps rows with an absolute cursor CSI and pads with
spaces — after `stripAnsi` both sit on ONE line, 97 spaces apart in the measured
capture. A matcher anchored on a line break passes on dumps and silently misses
every attached terminal, so the row tolerates either. One live-captured gap
remains documented in the row itself: a pane narrow enough to wrap the question
would break that adjacency.

**The workspace-trust dialog is a second, different block**, and it gets its own
row rather than a widened permission pattern. Before a `claude` in a directory
with no trust record will run anything it asks whether the folder is trusted, and
waits — as blocked on a human as any permission decision, and previously reported
as `unknown`, so a session parked there looked like a session with nothing to say.
Captured at 50 and 120 columns plus raw redraw bytes; two measurements decided the
shape:

- **Its question never ends its row.** At both widths the prose that follows runs
  on the same line, so the permission row's "question, then option list" shape can
  never see this dialog. That is why it was a documented gap and not a one-line
  addition to that row.
- **Question-to-option distance was 845 characters** on the attached path (padding
  runs of 7, 146, 179 and 226 between rows at 120 columns) and it scales with pane
  width, so any bounded conjunct would go quiet on a wider terminal. The row rests
  on the first option line alone — list number plus the label, starting its row —
  which holds at every width. Evidence is that option line, because it says what
  answering the dialog means.

The three `working` rows were anchored the same way, and for the same reason:
measuring the blocked fix caught a live pane reading `working` purely because the
screen was displaying the paragraph you are reading. Each row now requires
something a render has and a quotation does not — verified against fresh dumps
*and* raw redraw bytes of real `claude` 2.1.220 and `pi` 0.80.3 turns:

- **The status line is anchored on its elapsed-time reading, not its glyph.** The
  spinner glyph rotates (four distinct code points in a single captured turn), so
  pinning it would pin noise. Every captured status line carried the duration; a
  gerund without one is prose, or a tool's own progress line whose parenthetical
  is a key hint rather than a clock. The duration sits in a lookahead so the
  reported evidence stays the verb and does not churn every frame.
- **The pending-tool marker has to own its line.** Line start or whitespace
  before it, whitespace or line end after it, and a two-character pad between
  marker and word — which in the render is a space followed by U+00A0, not two
  spaces. A quotation has a delimiter on at least one side and pads with one.
- **pi's literal counts only behind a braille spinner glyph** (the whole
  U+2800–U+28FF block, since ten frames of it were captured in one turn).

`turn-complete` (`<PastVerb> for <N>s`) is anchored the same way — it must own its
row, behind an optional glyph — and it mattered more than the others because
`wait --via screen` can resolve a real wait on `idle`: a screen merely *printing* a
completion line could unblock an agent early. Its capture also turned up a bug
none of the anchoring work would have found:

- **The status verb is not ASCII.** The captured line read `Sautéed for 3s`, which
  a `[A-Z][a-z]+` class does not match at all — so a genuinely finished turn was
  not matching the row meant for it. It still reported `idle`, but through
  `prompt-resting`, the row of last resort, which means the state was right by luck
  and would have gone `unknown` the moment the human typed into the prompt box.
- The shipped vocabulary confirms it: `strings -a` on the 2.1.220 binary carries
  `Saut\xE9ed` / `Saut\xE9ing`, and of the 185 capitalised verbs visible in that
  region five more are hyphenated (`Dilly-dallying`, `Fiddle-faddling`,
  `Razzle-dazzling`, `Sock-hopping`, `Topsy-turvying`) — **six known misses**, in
  both the past-tense and gerund rows, since they share the vocabulary. Both now
  use `\p{Lu}[\p{Ll}'-]*` with the `u` flag.
- The glyph (U+273B in all 70 captured frames) is corroboration, not the anchor.
  The neighbouring status line rotates through at least four glyphs, so betting on
  one here would repeat a mistake the row next door already disproved.

`prompt-resting` stays last regardless; its correctness is ordering, not pattern.

`prompt-resting` (an empty `❯` input line) is the one row whose correctness
depends entirely on **ordering**, and it is last for that reason. The prompt box
is on screen during a turn as well — a dump of a working session showed that
exact empty line six rows under a live `Recombobulating…` spinner — so the row
means "the UI is up and nothing above matched", not "a prompt exists". It earns
its place because a finished session whose `"<PastVerb> for <N>s"` line has
scrolled out of the viewport is the most common screen on a long-lived box: 19
of 25 polled terminals read `unknown` before it existed. Two costs are accepted
knowingly — a bare shell whose own prompt is `❯` also reads `idle` (defensible;
an empty shell is idle), and a working frame that carries no spinner would read
`idle` for one poll interval before the next pass corrects it.

That row is **claude's** prompt, though, and `pi-prompt-resting` above it is pi's.
They are disjoint by construction: pi draws no prompt glyph at all — `❯` appears
nowhere in its shipped `dist/` — and its editor is two full-width rules with an
empty row between them, so claude's row could never fire on a resting pi and one
classified `unknown` with no screen evidence. **The gap costs more for pi than it
did for claude**: pi writes no `state.json`, so state comes from the shape of its
transcript, where `done` plus a live pid means *either* resting at the prompt *or*
mid-tool-call (the tool-use message stays the last entry until the result
returns). Only the screen separates those, which makes this row the only thing
that ever corroborates a pi `done`.

The anchor is pi's **context reading**, and reading the shipped source is what
picked it: every stats field in pi's footer is conditional on a non-zero counter,
so a pi that has answered nothing shows no arrows, no cost, no cache-hit rate —
and that is precisely the pane the daemon most needs to read, a freshly dispatched
one sitting at its prompt. The context reading is the one part pushed
unconditionally. A row anchored on the arrows would have passed a capture of a
used session and missed every fresh one. Both rendered forms are covered, including
the `?/<window>` pi draws before it knows the percentage; the window's `k`/`M`
suffix is required, since pi only omits it below 1000 tokens and no model's context
window is that small.

One cost is accepted knowingly and was captured rather than inferred: **pi draws
its footer underneath its modal overlays**, where claude's prompt box disappears
behind its dialogs. A pi parked on a selector waiting for a keypress — `/trust` was
captured doing exactly this — reads `idle` where it used to read `unknown`. The
trade holds because a resting pi is the common case and had no evidence at all,
while the modal case needs a human to open a modal and walk away. The real fix is a
`blocked` row for pi's modals above this one, and it is deliberately not bolted on:
the three components sharing the `↑↓ navigate` hint are three of 56 selector
components in pi's `dist/`, so anchoring on that hint would swap one wrong answer
for an unknown number of them. Own change, own captures.

- `GET /terminal/states` — `{ "<scope>:<id>": { scope, id, state, matcher,
  evidence, screenReadAt, stateChangedAt } }` for every terminal classified so
  far, so a client that connects late can render a chip immediately.
  `pid terminals` (see "Agent-facing CLI" below) is the same map for an agent, so
  this classification is not browser-only.
- **Every record carries two timestamps, and they answer different questions.**
  `screenReadAt` is when that row's screen was last actually read — the freshness
  of the evidence; `stateChangedAt` is when the classification last changed — the
  dwell. On a resting pane they are routinely hours apart, and the single `at`
  they replaced held the CHANGE time while `explain` rendered it as
  "observed <age> ago": measured live, 38 of 51 rows claimed a 105-minute-old
  observation while `wait --until-output` matched off a dump of the same panes
  taken 7s earlier. A reader deciding how much to believe a reading was being
  handed the one number that could not answer that. Every consumer now names
  which it means (`readAgeMs` / `unchangedForMs` on explain, `read 7s` / `for 2h`
  in `pid terminals`).
- `terminal.state` SSE event — published only on an actual state change (no
  event per keystroke), throttled to at most one classification pass per
  400ms per connection so a fast-redrawing spinner doesn't cost a regex pass
  per chunk. **A re-read that found the same thing publishes nothing**: it moves
  `screenReadAt` in the map through `markTerminalScreenRead` and stays off the
  bus, because ~50 identical rows per interval to every connected browser is
  worse than the staleness it would cure. The cost is explicit: a client that
  only listens to SSE sees its `screenReadAt` age until the next transition, so
  anything judging freshness re-reads `GET /terminal/states` (which also kicks a
  refresh-on-read pass) or `GET /sessions/:id/explain`.
- Two producers write the same map and the same event. The WS tap above covers
  every terminal a browser is looking at; the **unattended poller** below covers
  the rest. Both also stamp `screenReadAt` on an unchanged reading — the tap once
  per throttle window, the poller once per pass per row.
- Three consumers read that event: the web chip, `sessions-wait` (`via screen` /
  `untilOutput`), and the rules engine's screen triggers (see "State-change
  rules"). None of them imports this slice — they all decode the bus payload — so
  the single writer `publishTerminalState` stays the only thing that has to be
  right about the record shape.
- The `state` and `matcher` vocabularies are published contracts in
  `shared/src/terminal.ts`, not local strings: a screen-triggered rule names both
  in a request body, so `features/rules` validates against the same lists this
  slice classifies with. `Matcher.name` here IS the shared union (a row named
  off-vocabulary is a type error) and a co-located test asserts the table covers
  the published list exactly, in both directions. The patterns and their ORDER
  stay here — a regex tuned against a live dump is this slice's business, and the
  ordering is a priority decision documented row by row.

#### Unattended sessions: the screen-dump poller (`terminal-poll.*`)

A `claude` or `pi` inside a zellij session nobody has opened in the dashboard
produces no WS bytes, so for a while it was invisible: no chip, and nothing for
`features/rules/` or `POST /sessions/:id/wait` to react to. The worst case was a
dispatched pi run — `features/dispatch/pi.io.ts` creates those *detached*
(`zellij -n <layout> attach -b <name>`), so one was never classified at all
unless a human opened its terminal tab.

`terminal-poll.io.ts` closes that: every `PID_TERMINAL_POLL_MS` it dumps the
screen of each zellij session this daemon owns that has **no** attached WS, and
folds the result through the *same* pure `stripAnsi` / `appendTail` /
`classifyTail` / `decideTransition` the WS tap uses, into the same
`terminalStates` map and the same `terminal.state` SSE event. No client change
was needed.

- **The incantation matters.** `zellij --session <n> action dump-screen` returns
  an EMPTY string and exit 0 when no client is attached — it dumps the *focused*
  pane, and a client-less session has no focused pane. Adding
  `--pane-id terminal_0` returns the real screen. Verified against zellij 0.44.3
  on both client-less shapes: a session created with `attach -b` and never
  attached, and one whose client attached and then went away. The dump is live,
  not frozen at detach time. That is why the poller spends a `zellij action
  list-panes` first, keeps only `TYPE=terminal` rows and dumps each one by id.
  The daemon's own layouts no longer emit any plugin pane (see "Zellij paints no
  chrome" below), so today that filter only has to survive panes a *human*
  opened; it is kept because a `plugin` row's screen would classify zellij's UI
  rather than the agent.
- **Every pane, not only the first.** A zellij session can hold more than one
  terminal pane, and an agent running in the second one used to be invisible to
  chips, `wait --via screen`, `explain`, `pid terminals` and rules all at once —
  every screen-derived feature reported on one pane and called it the session.
  Each pane now gets its own row in the same registry, keyed
  `<scope>:<id>#<paneId>` (`terminalPaneRowId`), beside the unchanged
  session-level `<scope>:<id>` row that every one of those features addresses.
  Pane rows exist only while a session has MORE THAN ONE terminal pane — for the
  ordinary one-content-pane session a pane row would just duplicate the session
  row — and the poller drops a pane's row as soon as `list-panes` stops reporting
  it (`stalePaneKeys`, which by construction can never touch the session-level row
  or another terminal's). Rows are dropped server-side with no SSE event: no
  client renders pane rows, since the browser looks its chips up by exact
  `<scope>:<id>`.
- **When panes disagree, the session row reports the most attention-worthy pane:
  `blocked` > `working` > `idle` > `unknown`.** The two candidate answers fail
  asymmetrically. A session-level `working` that hides one pane sitting at an
  unanswered prompt hides a stall NOTHING will clear on its own: the wait built to
  notice it never fires, the rule built to answer it never runs, and the cost is
  unbounded time. A session-level `blocked` that hides two generating panes costs
  one wasted look — the next pass corrects it the moment the prompt is answered,
  and the working panes have their own rows in the same map. `working` outranks
  `idle` one step down for the same reason: `idle` is what
  `wait --until idle --via screen` settles on, so a resting shell beside a
  generating agent would report a session as finished mid-run. `unknown` ranks
  last because no matcher firing is the absence of evidence, not a state.
  `foldPaneReadings` returns the winning pane's reading VERBATIM — matcher,
  matched line and `paneId` — so a session row is a citation of a real screen,
  never a synthesized state no pane was in. Ties go to the lowest pane index, so
  an unchanging screen yields an unchanging row.
- **The session row now says which pane it read.** `paneId` on the record (and on
  the `terminal.state` SSE payload) is the fold's provenance; it is `undefined`
  only from the WS classifier tap, which sees one byte stream for the whole
  session and no pane ids at all. A screen observation (`wait --until-output`)
  keeps the SESSION's id whichever pane it came off — a pattern on any pane is a
  pattern on that session's screen, which is the point — and carries `paneId`
  alongside.
- **A dump is a snapshot, not a chunk**, so it *replaces* the rolling tail rather
  than appending to it. Appending would keep every earlier screen inside the
  window, and since `classifyTail` is first-match-wins over the whole tail, one
  answered `"Do you want to proceed?"` would outrank the live spinner for the
  rest of the daemon's life. `foldScreenDump` passes an empty prior tail to
  `appendTail`, which reuses that helper unchanged for the one thing still
  wanted: keep the LAST `maxChars`, i.e. the bottom of the screen.
- **Ownership is by derivation, not by name shape.** With the default empty
  `PID_ZELLIJ_PREFIX` this daemon's session names are user-global on purpose (see
  below), so nothing about the string `default` says who owns it.
  `selectPollTargets` therefore intersects the daemon's OWN candidate list —
  global, orchestrator, every project, every roster short, every `pi-<short>`,
  each name built through `prefixedZellijSession` — with what `zellij
  list-sessions` reports as live and not `EXITED`. A session this daemon never
  derived is never dumped, so a second daemon's namespaced sessions and the
  user's hand-made ones are untouched.
- **No double classification.** A terminal with a live WS bridge is already
  classified byte-accurately, so the poller skips it. Tracked by zellij *session
  name* (refcounted, because StrictMode double-mounts overlap two bridges), not
  by `scope:id`, since one session can be reached under more than one URL id.
- **Off switch and cost.** `PID_TERMINAL_POLL_MS` (read in
  `platform/config.io.ts`, the config funnel; default **15000**). `0` disables
  the poller entirely — no timer, and the refresh-on-read hook goes inert too.
  It is deliberately lazier than the attached path's 400ms throttle because each
  polled session costs a `list-panes` spawn plus one `dump-screen` spawn PER
  PANE, where the attached path costs a regex over bytes it already has.
- **The real cost of a read is a repaint in somebody's terminal, not the
  daemon's wall clock — and that is what set every number below.** Measured on
  zellij 0.44.3: a zellij CLI client CONNECTING makes zellij repaint the full
  screen for its attached clients, ~1-2 repaints per connection, and it is
  **cross-session** — reads aimed at session A repaint an attached client of
  unrelated session B. So a pass's spawn count is not a private cost. At 28
  targets, the old pass made 62 connections (1 `list-sessions` + 29 `list-panes` +
  34 dumps, verified with a PATH shim that logged every invocation) and delivered
  ~110-220 full-screen repaints — 400KB-1MB of ANSI — into every open terminal
  WebSocket inside a 2.3-second window, once every 15s. The dashboard's terminal
  froze for about two seconds every fifteen, and so did the user's own `zellij
  attach` in a native terminal. Confirmed from the other side too: a pty client
  attached to a session this daemon does **not** own and never polls still took a
  repaint storm every 15.00s, and 21 hand-fired reads at *other* sessions
  reproduced one on demand. If you are about to add a zellij read anywhere on a
  timer, that is the cost to price it at.
- Four constants bound the pass, all in the pure core with their arithmetic:
  `MAX_PANES_PER_SESSION` (4) stops one tiled session consuming a pass — and is
  the same ceiling the write surface enforces when a caller asks for a new pane
  (see "Panes: the daemon's only write surface into zellij" below), so raising
  it raises both. `MAX_READS_PER_PASS` (64) and `MAX_READS_PER_PASS_WATCHED` (12)
  bound the whole pass, counting **every** connection — `list-sessions` and
  `list-panes` as much as the dumps. That the pane lists went uncounted is why the
  old bound of 64 *dumps* still grew with the session list: it capped 34 of the 62
  connections a pass actually made. The two numbers answer different questions, so
  collapsing them would trade one regression for another: the tight one is what a
  watched browser terminal absorbs without a hitch (12 reads ≈ 25 repaints over
  ~0.5s), the loose one is how fresh an unwatched machine's chips are. `watched`
  means at least one terminal WS bridge is attached — exactly when a repaint has a
  browser to land in.
- **A quiet screen is not re-read.** Per target, `PollCadence` doubles the gap
  after each read that finds the same screen (1, 2, 4, then `MAX_BACKOFF_PASSES`
  = 8, so ~2 minutes at the default interval), and resets to every pass the moment
  the screen moves. The signal is a `screenFingerprint` of the dumped text, not the
  classification, and that direction matters both ways: a working agent's spinner
  churns every frame while its slug sits at `working` (a classification-driven
  backoff would starve the busiest terminal, the one someone is most likely waiting
  on), and a `blocked` prompt is byte-identical until answered (so it would look
  fresh forever while nothing happened). A fingerprint rather than the text itself,
  because a per-terminal copy of every screen is real memory and screen text is the
  one thing this slice never retains. An **output wait suspends the backoff
  entirely** (`hasScreenWaiters`, wired to `screenObservers.size > 0`): `pid wait
  --until-output` resolves off these passes and nothing else, so a backed-off target
  would silently add up to 8 passes of latency to a wait that advertises the poll
  interval. Pane lists are cached for `PANE_LIST_REFRESH_PASSES` (8) on top of that
  and dropped early by any empty dump, since a pane set changes far more slowly than
  the interval. Measured end to end against the old poller on the same machine, same
  sessions, with a terminal attached: **59 reads per pass over 2.30s → 12 over
  0.51s.**
- Passes are sequential, never fanned out, and coalesced (one in flight
  at a time), so a pass that did overrun would cost freshness rather than pile
  subprocesses up. The budget skips WHOLE sessions, never half of one: a fold over
  a partial pane set could report `working` for a session whose unread pane is
  blocked, which is exactly what the ordering exists to prevent. It also stops at
  the first target it cannot afford rather than walking the rest to skip each one —
  which is what keeps the rotation cursor honest, since a cursor advanced by
  *skipped* targets walks back to 0 every pass and re-reads the same head forever.
  And because a
  budget that always truncated the same tail would make those terminals
  permanently invisible — the very blind spot per-pane polling removes — each pass
  starts where the last one stopped (`rotateTargets` / `advancePassOffset`),
  turning truncation into bounded staleness. One session dying mid-pass does not
  abort the rest, and one unreadable pane costs only its own contribution to the
  fold.
- **Not just the interval.** This daemon has lost every `setInterval` in the
  process on a long uptime while its sockets stayed alive (the session registry
  refreshes on read for exactly that reason), so `GET /terminal/states` also
  calls `terminalPoller.refreshIfStale()` — a no-op unless polling is on and the
  last pass is older than the interval. Fire-and-forget: the response is the map
  as it stands, and the new pass arrives over SSE rather than making a chip
  request block on 2N spawns.
- Constructed at module load but **inert**; only `server.ts`'s `startDaemon()`
  calls `start()`. Importing `api.ts` must never begin spawning `zellij` against
  a user's live sessions — the same construct-then-start split the rules engine
  uses.
- **Still not covered**: a polled `pi`/`claude` whose zellij session the daemon
  cannot name (started by hand outside the dashboard's naming scheme); panes past
  `MAX_PANES_PER_SESSION` in one session; a session drill-in exposed under a
  `daemonShort` alias, whose polled record is keyed by the canonical roster short,
  so the chip appears under that id rather than the alias; and pane rows of a
  session a browser is attached to — the WS tap owns the session row while the
  bridge lives and cannot attribute bytes to a pane, so the pane rows stop being
  refreshed (their `at` shows it) until the bridge closes and the next pass prunes
  or refreshes them.
- Evidence for every VERIFIED row is one of three kinds, named in the row's own
  comment: bytes captured from a real pty run, a live `dump-screen` of a real
  session, or a literal read straight out of the shipped CLI — `strings -a` on
  the Claude Code binary (`~/.local/share/claude/versions/<version>`, a single
  compiled Mach-O executable), or pi's unminified `dist/` source directly for
  `"Working..."`. No row was fabricated from memory of what a CLI "probably"
  prints. **The three are not interchangeable**: a binary literal proves the
  string exists, only a render proves it reaches a screen, and only a render
  shows what surrounds it. The permission rows shipped on strings alone and both
  errors that cost — one wrong claim, one self-referential false positive — were
  only visible in a render. Getting one took `--permission-mode manual` plus an
  explicit `--settings '{"permissions":{"ask":["Bash"]}}'`, because otherwise the
  box's broad user-level allow-list auto-approves the call and no dialog is ever
  drawn. That is now the recipe, not a blocker. One row is still strings-only and
  says so: the `"No, and tell Claude what to do differently"` option label exists
  four times in the 2.1.220 binary, but neither captured dialog rendered it
  (2.1.220 draws a bare `"No"`), so it is kept as an anchored fallback for the
  variant that does. See the matcher table's comments for the full trail per row,
  including a documented pi hint (`(escape to interrupt)`) that exists in source
  but was not observed live, so has no matcher of its own.
- **Self-reference is a live failure mode of screen scraping, not a curiosity.**
  Any matcher keyed on a bare sentence fires on a terminal that is merely
  *discussing* that sentence — an agent editing this table, reviewing its diff or
  displaying this file. **All nine rows are anchored against it now**: the three
  `blocked` rows (question + option list, option label + list number, own-row trust
  option), the three `working` rows (elapsed-time reading, own-line pending marker,
  braille spinner), `turn-complete` (own row behind an optional glyph),
  `pi-prompt-resting` (a context reading with a token-suffixed window) and
  `prompt-resting`, which is a whole-line pattern to begin with. Two habits keep it
  from coming back: **anchor on a rendered shape, never a bare sentence**, and
  **write placeholders in comments and docs, never a complete rendered line**. A
  regression here is invisible without measurement, because the matcher does not
  fail on the fixtures — it fails on the file that describes it.
- **A pattern can be self-reference-proof and still wrong.** Anchoring says which
  screens a row must ignore; it says nothing about which real screens it must
  catch. Every row here was also measured against a live render of the thing it
  claims to match, and that is what caught `turn-complete` not matching an accented
  verb and `permission-prompt` not matching a Write approval — two silent false
  negatives that no amount of anti-self-reference work would have surfaced.
- **Which CLI a row covers is part of its claim.** Every row is one CLI's UI copy:
  the three `blocked` rows, `tool-call-waiting`, `thinking-gerund`, `turn-complete`
  and `prompt-resting` are claude's; `pi-working` and `pi-prompt-resting` are pi's.
  Audited row by row against live captures of both CLIs, and the audit is worth
  repeating whenever a row is added, because "pi is covered" was true of the working
  state and false of the resting one for as long as nobody checked. pi has no
  automatic `blocked` screen to miss in the default flow — a captured pi ran a bash
  tool call with no approval step, and its `Project trust` selector only opens on an
  explicit `/trust` — but see `pi-prompt-resting` for the modal-overlay cost that
  follows from it.

### Zellij paints no chrome

Every layout `terminal.core.ts` generates is a bare `tab { … }` holding the
content pane and nothing else. Each one used to open with a
`default_tab_template` wrapping `children` in two plugin panes —
`zellij:tab-bar` (1 row, top) and `zellij:status-bar` (2 rows, bottom) — so the
zellij UI showed regardless of the user's own config. Those three rows were the
one surface inside the terminal pane that the dashboard's theme system could not
reach.

The pane is themed in two layers and neither owns those rows: daisyUI paints the
panel, and `apps/web/src/features/terminal/terminalTheme.ts` hands xterm a
sixteen-slot palette per resolved theme. A plugin pane's bars are drawn by
*zellij*, inside the pty, from **zellij's** theme, and arrive at xterm as
already-coloured cells. zellij's default theme is dark, so each of the four light
themes rendered a light terminal with a black strip glued to its top and bottom.

Theming them to match was the alternative and it is a worse shape whichever way
it is done. A zellij session is server-side, long-lived and **shared** while the
theme is a per-browser choice, so two browsers on different families attach to
one pty and there is no single right answer for the chrome to take. A neutral
compromise palette would have to read against four light and four dark panes at
once — the "one pair shared by every family" shape the per-theme xterm palettes
were built to replace. And `zellij --config <file>` *replaces* the user's config
rather than merging, so it would take their keybindings with it.

Deleting the plugin panes needs no answer to any of that: there is nothing left
to theme. It also returns three rows to the terminal, and the dashboard already
carries its own tabs, session list, state chips and pane API — the bars were
duplicating the app's navigation in a strip the app could not paint.

Measured against zellij 0.44.3 while deciding:

- A layout **file** does accept config nodes at its top level: `theme "x"` plus a
  `themes { … }` block parses and boots, while a `theme` node *inside*
  `layout { }` is rejected as an unknown layout node. So a per-project or
  per-session zellij theme is technically reachable without touching the user's
  config — it would still only apply on the create branch (every reconnect is an
  `attach`) and still has to pick one answer for all viewers.
- `layout { tab { pane } }` materialises tab #1 holding `terminal_0` and no
  plugin panes (`zellij -n <file> attach -b`, then `action list-panes`). The
  explicit `tab { … }` wrapper is what puts the content in the FIRST tab, so it
  is kept from the templated shape.
- The orchestrator's split keeps its labels: `action list-panes` reports
  `terminal_0 orchestrator` / `terminal_1 agents` from the layout's `name=`, and
  a `pane_frames true` config still draws those names on the frame. Pane frames
  are untouched by this change.

What it costs: a user who opens a second zellij **tab** (`Ctrl t n`) no longer
sees a tab bar naming it. Keybindings are unaffected — they belong to the client,
not to the plugin panes.

`terminal.core.test.ts` holds every layout to this through one shared
`expectNoZellijChrome` helper, so a new layout cannot reintroduce the defect by
copying an old one.

### Zellij session names are user-global on purpose (`PID_ZELLIJ_PREFIX`)

Every zellij session name the daemon derives — `default` for the global tab,
`Orchestrator`, `<project>` for a project terminal, `<short>` / `pi-<short>` for
a drill-in — is global to the OS user, not scoped to the daemon that produced
it. That is deliberate in three places, and each one breaks if the names are
namespaced by default:

- `ORCHESTRATOR_ZELLIJ_SESSION` must byte-match `voice-event.sh`'s
  `ORCHESTRATOR_SESSION`. That hook types every worker's Stop/Notification
  event into the session by that name, so renaming it sends the fleet's reports
  to a session nobody is watching.
- Project terminals are named after the repo directory because the user's repo
  dirs are conventionally also their own zellij session names — the dashboard
  attaching to a session they already have open is the feature, not a bug.
- Someone running the packaged `pid-dashboard` wants their real sessions, not a
  private copy of them.

The defect that follows from it is narrow: a **non-primary** daemon had no way
to opt out. A test run, an e2e run, a second checkout, or a second daemon on
another port would attach to — or create — the user's real sessions, and its
keystrokes would land in their panes. This happened: a verification daemon on
port 18791 drove `/terminal/global`, created a fresh OS-user-global `default`
session, and typed into a leftover confirmation pane that had nothing to do
with the test.

`PID_ZELLIJ_PREFIX` (read once in `platform/config.io.ts`, threaded to the
terminal routes as data) is that opt-out. It defaults to `""`, and an empty
prefix returns each name **unchanged byte for byte**, so production behaviour is
provably today's. A non-empty prefix namespaces all five name derivations *and*
the four DELETE kill paths — a prefixed daemon that killed the unprefixed name
would be killing the user's session, which is the original bug wearing a hat.
`apps/e2e/global-setup.ts` sets `PID_ZELLIJ_PREFIX=e2e`, so an e2e run can no
longer touch them.

Names stay inside zellij's 64-char cap, and the truncation direction matters:
the prefix is bounded so a minimum budget always remains for the name, and the
name is trimmed from the **front**, keeping its tail. Trimming the end would map
two long names sharing a common stem onto one session — the same hijack, one
level down. Both edge cases are covered in `terminal.core.test.ts`.

#### The site the prefix originally missed: creating a pi session

Every derivation above **reads** a name. Exactly one place **mints** one outside
the terminal slice — `features/dispatch/pi.io.ts`, which creates the detached
zellij session a dispatched pi run lives in — and it was not prefixed. So on any
daemon with `PID_ZELLIJ_PREFIX` set, the dispatch created `pi-<short>` while the
attach path and the poller both resolved `<prefix>-pi-<short>`, and three things
broke without a single error:

- **the poller** had no terminal-state row for the session at all, so
  `GET /sessions/:id/explain` reported `terminal: undefined` — silently removing
  the only independent evidence a pi session has (there is no `state.json`);
- **`DELETE /terminal/<short>`** answered `{"ok":false}` and left the session
  running: the daemon could not kill what it had just started;
- **attach** took `zellijAttachOrCreate`'s create branch and resurrected a
  *second* pi on the same session id under the prefixed name. Two processes
  appending to one transcript, the real run left invisible — observed as two live
  `pi` pids in one cwd.

It is fixed where the name is minted (`piDispatchSessionName`), not by teaching
the readers to try a second candidate: the prefix is a property of the daemon, so
every name it derives must carry it. Because an empty prefix returns the name
unchanged byte for byte, the fix is a **no-op on any default daemon** — including
the user's — so no already-running session is orphaned. On a prefixed daemon the
pre-existing sessions were already unreachable by all three readers; nothing
regresses.

The agreement between the minting side and the reading side is asserted in
`scripts/mirrored-constants.test.ts` rather than in either slice, for the reason
that file exists: neither slice may import the other's internals, so neither
could hold the check. It also pins the *call site* — `pi.io.ts` may derive a pi
session name in exactly one place — because testing only the helper would let the
original bug straight back in.

## Brainstorm boards (session-scoped drawings)

A brainstorm board is **any drawing file in the tree a session works in**. There
is no registry and no blessed directory: the daemon walks the session's worktree
(falling back to its cwd) and every matching suffix is a board.

| Suffix | `kind` | On disk | Editor |
| --- | --- | --- | --- |
| `*.canvas` | `canvas` | Obsidian JSON Canvas (jsoncanvas.org) | React Flow |
| `*.canvas.json` | `canvasJson` | the older React-Flow encoding — read/write, never created | React Flow |
| `*.excalidraw` | `excalidraw` | native Excalidraw scene | Excalidraw |

A board's **identity is its worktree-relative path**, so moving the file is a
plain `git mv` and nothing else. New boards land in `brainstorms/<name>.canvas`
because a default has to be somewhere; nothing depends on them staying there,
and boards created before this design (`.pid/brainstorms/*.canvas.json`) keep
working because they are found by suffix like anything else.

Pure rules in `features/brainstorms/brainstorms.core.ts` (suffix → kind, path →
label, discovery, the default create path); the shell
(`brainstorms.io.ts`) is plain async functions over an already-resolved root,
mirroring `fileBrowser.io` — no Effect layer, because there is no dependency to
inject once the router has resolved *which* tree.

Daemon (`features/brainstorms/`, mounted on the sessions router in `api.ts`; the
root resolver is passed in, so the slice never imports the sessions slice):
- `GET  /sessions/:id/brainstorms` — every board in the tree, ordered by path.
- `POST /sessions/:id/brainstorms` — create `{ name, kind? }` under `brainstorms/`.
- `GET|POST /sessions/:id/brainstorms/canvas?path=<rel>` — snapshot / publish.
- `GET  /sessions/:id/brainstorms/canvas/ws?path=<rel>` — live sync (WebSocket).
- `GET|POST /sessions/:id/brainstorms/excalidraw[/ws]?path=<rel>` — same, native.

Both canvas encodings decode to one `CanvasSnapshot` on the wire, so the socket,
the routes and the browser editor are shared and only the bytes on disk differ
(`features/canvas/jsonCanvas.core.ts` is the Obsidian codec; `canvas.io.ts` is
the slice's room door for both).

**Why the session and not the project.** The boards live in the tree the session
already owns, so when its agent writes the file the browser is looking at, the
write lands. The project-scoped version asked a session to write *outside* its
own worktree — which is the edit that used to go missing. The drill-in's
Brainstorm tab therefore docks the board beside that session's own terminal, and
"Brief AI" hands the agent the board's absolute path plus the format it must
write (`canvasBriefing.ts` — naming the wrong shape produces a file the editor
then refuses to decode).

**Brainstorm is the only drawing section.** The drill-in used to dock a *Canvas*
tab as well, editing one scratch file per job dir
(`~/.claude/jobs/<short>/canvas.json`) over a `/canvas/:id` route. That file sat
outside the tree its session works in, so it hit exactly the miss described
above, and a board covers the same need with a file the agent can see. The tab,
the route, `getCanvasRoom` and `canvasPathFor` are all gone; `features/canvas`
now contributes only the editor, the codecs and the codec-generic doc-room
socket that `brainstorms.routes.ts` mounts. Do not re-add a session-scratch
drawing — create a board.

## Per-project pid-apps (`.pid/` HTML)

Drop any static HTML site into a project's `<project>/.pid/` directory and the
dashboard surfaces it as a sandboxed, project-scoped tab — zero config, no
manifest. Use it to render specs/plans as HTML in-app or run a small static tool.

Discovery (`features/pid-apps/pid-apps.core.ts`, pure):
- A subdirectory of `.pid/` containing an `index.html` is an app; `appId` = the
  dir name (must match `^[a-z0-9][a-z0-9._-]*$`).
- A bare `.pid/index.html` is the implicit `default` app.
- Reserved names are never apps: `extensions`, `extensions-state.json`,
  `settings.json`, and the `default` dir name.
- Optional `<app>/pid-app.json` (`{ title?, entry?, icon? }`) overrides
  presentation only; `entry` is constrained to a single `*.html`/`*.htm` file.

Daemon (`features/pid-apps/`, mounted on the projects router):
- `GET /projects/:id/pid-apps` — list a project's apps.
- `GET /projects/:id/pid-apps/:appId[/*]` — stream an asset (the entry when bare).

Security (the dropped HTML is UNTRUSTED):
- Rendered in `<iframe sandbox="allow-scripts">` only — opaque origin, no parent
  DOM/storage/cookie access — with NO postMessage/RPC bridge.
- Every served response carries a strict CSP (`default-src 'none'; … connect-src
  'none'`), `X-Content-Type-Options: nosniff`, and `Cache-Control` (`no-cache`
  for HTML).
- Path access is guarded in layers: `validateRelPath` (pre-fs; rejects `..`, `\`,
  leading `/`, including single-decoded double-encodes), lexical containment, the
  default-app reserved-internal exclusion, and an `fs.realpath` containment check
  that refuses symlinks escaping the app root.
- ⚠ No auth: like `/projects/:id/raw`, these routes are reachable by anyone who
  can reach the daemon (e.g. over the Cloudflare tunnel) — the list endpoint
  enumerates `.pid/` and the serve route streams its files. Accepted, pre-existing
  exposure; do not drop secrets into `.pid/`.

Spec: `specs/pid-html-extensions.html`. A NEW lightweight feature, kept separate
from the manifest-based extension platform (`platform/extensions/`).

## Fleet recipes (`.pid/fleet.json`)

A fleet recipe is a declarative, re-runnable description of a multi-agent
run: N steps, each spawning `n` agents that share an `intent`, plus `needs`
dependencies between steps. herdr (workspaces, no scripted templates — its own
docs leave automation to shell scripting over its CLI) is the closest existing
tool and deliberately does not cover this; this repo already has every
ingredient (`/dispatch`, the spawn allow-list, server-owned waits), so a
recipe is just the missing persisted description tying them together.

`GET /projects/:id/fleets` and `pid fleets` are read-only (schema + validation
+ discovery). Executing a recipe is a separate, explicit step — see
"Executing a run" below — so nothing in this feature ever spawns a session as
a side effect of parsing or discovering one.

### File format — `<project>/.pid/fleet.json`

```jsonc
{
  "fleets": [
    {
      "name": "review-and-fix",            // required, unique across the file
      "description": "three reviewers, then one fixer",  // optional, presentation-only
      "steps": [
        {
          "id": "review",                  // required, unique within this fleet
          "intent": "review the working diff for bugs",  // required, non-empty
          "n": 3,                          // optional, default 1, integer 1..20
          "agent": "reviewer",             // optional — passed to /dispatch verbatim
          "cwd": "apps/web"                // optional — passed to /dispatch verbatim
        },
        {
          "id": "fix",
          "intent": "fix what the reviewers found",
          "needs": ["review"],             // optional, step ids in this fleet that must finish first
          "until": ["done"],               // optional, non-empty array of session-state slugs
          "timeoutMs": 600000              // optional, requires `until`; 1..600000 (10 min)
        }
      ]
    }
  ]
}
```

`n`, `agent`, `cwd` mirror the fields `POST /dispatch` already accepts for one
spawn; a step's `n` agents would each get their own independent dispatch call
with the same `intent`/`agent`/`cwd`. `needs`/`until`/`timeoutMs` describe the
wait the (future) runner applies to a step's own sessions before its
dependents start — the same `{ until, timeoutMs }` shape as `POST
/sessions/:id/wait` (see "Server-owned waits" above); a step with no `needs`
starts immediately, a step with no `until` has nothing to wait for before its
own dependents look at its `needs`.

### Wave semantics

Steps are grouped into **waves** by topologically sorting on `needs`: every
step in a wave is independent of every other step in that wave (they can run
concurrently), and a wave only starts once every step in every earlier wave
has resolved. A diamond (`a` then `b`+`c` in parallel then `d`) becomes three
waves: `[[a], [b, c], [d]]`. `GET /projects/:id/fleets` computes and returns
this plan (`apps/daemon/src/features/fleet/fleet.core.ts` `planFleetRun`) for
every fleet that parses cleanly, so an author can see the concurrency their
recipe implies before wiring a runner up to it at all.

### What validation rejects, and why

`parseFleetFile` collects **every** error in one pass — not just the first —
because a hand-edited recipe should get a full worklist, not a
fix-one-rerun-see-the-next loop:

- A fleet name and a step id must be non-empty strings; fleet names are
  unique across the file, step ids unique within their own fleet (needed
  because `needs` references a step by id).
- `intent` must be non-empty — an agent with nothing to do is never useful.
- `n` must be an integer from 1 to 20: spawning agents costs the user's own
  API quota, so an unbounded `n` would let a typo (`n: 500` for `n: 5`) burn
  it silently; 20 is comfortably above any fan-out this repo's own dogfood
  recipes use.
- Every `needs` entry must name a step id that exists in the same fleet — a
  reference to another fleet, or to nothing at all, is rejected rather than
  silently ignored.
- The `needs` graph must be acyclic; a cycle is reported as one error naming
  every step still blocked, not a stack overflow or a runner that hangs.
- `until` entries must be one of the eight known session-state slugs (`done`,
  `working`, `blocked`, `needs_input`, `idle`, `failed`, `stopped`,
  `unknown`), and `timeoutMs` must fall inside the same 1..600000ms bound
  `POST /sessions/:id/wait` itself enforces — a recipe cannot ask for a wait
  the server would refuse anyway.
- `timeoutMs` without `until` is rejected: a timeout with nothing to wait for
  is very likely a typo, not intent.

A malformed file is never a 500: `GET /projects/:id/fleets` returns `200
{ fleets: [], errors: [...] }` (or a partial `fleets` list alongside `errors`
for the fleets that DID parse), and `pid fleets` prints every error and exits
2 — a linter an author can run before trusting a recipe. An absent
`fleet.json` is not an error either: `{ fleets: [], errors: [] }`, the same
"nothing configured yet" contract `pid-settings` uses for its own missing file.

### Worked example

The `review-and-fix` fleet above plans as two waves: `[["review"], ["fix"]]`
— wave membership comes purely from `fix`'s `needs: ["review"]`; `until` and
`timeoutMs` never affect the plan. `fix` additionally declares `until:
["done"]` / `timeoutMs: 600000`: that is the wait the runner applies to
`fix`'s own session before anything depending on `fix` would start. This
fleet has nothing downstream of `fix`, so that pair is inert for this
particular recipe — present because an author reviewing it wants to see the
intended shape regardless. This repo's own root `.pid/fleet.json` dogfoods two
real recipes in the same shape: a `review-diff` fan-out and a
`fix-then-verify` chain.

### Executing a run

`POST /projects/:id/fleets/:name/run` walks the wave plan above and actually
spawns it (`apps/daemon/src/features/fleet/fleet-run.*`). Everything about it
is designed around one fact: running a fleet spawns real agents against the
user's own subscription quota, so nothing here is allowed to surprise them.

- **Nothing auto-runs.** Discovery, parsing and daemon boot never spawn a
  session — only this POST does, and only when asked.
- **`{ "dryRun": true }` is the easy, safe default to reach for.** It runs the
  same planning and cap checks a real run would, and returns the resulting
  plan (waves, per-step session counts, the total) without spawning anything.
  `pid fleet run <name> --dry-run` is the CLI's own front door to it.
- **Two hard caps, enforced before a single session spawns**
  (`apps/daemon/src/features/fleet/fleet-run.core.ts`'s `DEFAULT_RUN_CAPS`):
  `maxTotalSessions` (50) — the sum of every step's `n` in the recipe, one
  level up from `MAX_STEP_N`'s per-step ceiling — and `maxConcurrentSpawns`
  (5) — how many spawn calls the engine allows in flight at once within a
  wave, chunking a wave's flattened spawn tasks and awaiting one chunk (spawn
  *and* its wait) before starting the next. A `maxTotalSessions` violation is
  a `400 { error: "cap_exceeded", violation: { _tag: "TotalSessionsExceeded",
  requested, max } }` — the plan is rejected outright, not silently truncated.
- **One active run per fleet per project.** A second `POST` for a fleet that
  already has a run in progress is refused with `409 { error:
  "already_active", runId }` naming the run already running, rather than
  starting a twin that would double-spawn the same recipe.
- **A failed dependency skips its dependents.** Waves are already ordered so
  a step's `needs` all live in earlier waves; when a wave starts, any step
  whose `needs` include a step that ended `failed` or `skipped` becomes
  `skipped` (recorded with which dependency didn't complete) instead of being
  spawned against a broken premise. A skip cascades wave by wave: if `a`
  fails, `b`/`c` (needing `a`) are skipped when their wave starts, then `d`
  (needing `b`/`c`) is skipped in turn when *its* wave starts.
- **Every spawned short is recorded before its wait starts.** A step's status
  moves `pending → spawning → (waiting →) done | failed | skipped`; the short
  a spawn call returns is appended to the step's own trail immediately, so
  `GET .../fleet-runs/:runId` shows it even if the daemon dies mid-wait —
  the underlying session itself also stays visible via `GET /sessions`
  regardless, since only the run's own bookkeeping is in-memory (this daemon
  persists nothing — see "4. Persistence — none in daemon" below).
- **A run's own status** is `running` until every step reaches a terminal
  status (`done`, `failed` or `skipped`), then `done` if every step succeeded
  or `failed` if any did not — a rolled-up verdict, not a diagnosis of which
  step or wait caused it (that detail lives on the individual step).

Endpoints:

- `POST /projects/:id/fleets/:name/run` — body `{ dryRun?: boolean }`
  (default `false`). Dry run → `200 { dryRun: true, plan }`. Real run → `202
  { runId, waves, totalSessions }`, execution continuing in the background.
  Cap violation → `400`. Twin run already active → `409`. Unknown project or
  fleet name → `404`. An invalid recipe (the same errors `GET .../fleets`
  would report) → `400 { error: "invalid_recipe", errors }` rather than
  trying to run something that didn't parse.
- `GET /projects/:id/fleet-runs` — every run started for that project, most
  recent first inclusion order, each the same run-summary shape below.
- `GET /projects/:id/fleet-runs/:runId` — one run's status: `{ id, projectId,
  fleet, status, totalSessions, startedAt, finishedAt, steps: [{ stepId,
  waveIndex, intent, n, status, shorts: [{ short, wait }], reason }] }`, where
  `wait` (once resolved) is the same tagged shape `POST /:id/wait` reports
  internally (`Satisfied | Timeout | OccupantChanged | Removed | NotFound`)
  and `reason` explains a `skipped` or `failed` status.

`pid fleet run <name> [--project <id>] [--dry-run] [--wait] [--json]` drives
this from the CLI; `--wait` polls `GET .../fleet-runs/:runId` to completion
and exits non-zero (`7`) if the run finished with a failed or skipped step, or
if the daemon refused to start it as a twin run — see "Exit codes" below.
`pid fleet runs [--project <id>] [--json]` lists every run for a project.

The project dashboard's **Fleets** tab (`apps/web/src/features/fleet/`,
`project-tab-panel-fleets`) is the same feature over the same endpoints: one
card per fleet with a dry-run action (no confirmation — it spawns nothing) and
a Run action gated behind a confirm dialog that states the exact cost in
plain words (sessions, waves, project), a live-updating run list fed by the
`fleet.run` SSE event, and a per-step view (`FleetRunView`) where a skipped
step is deliberately styled differently from a failed one. See "Frontend
skeleton" below.

## Panes: the daemon's only write surface into zellij

Until this landed, everything the daemon did with zellij was a read
(`list-sessions`, `action list-panes`, `action dump-screen --pane-id`) plus
attaching a WS bridge — a pane existed because a human made it. `POST
/terminal/panes` (`pid pane new <scope>:<id>`) opens a pane in a terminal the
daemon derived and owns, and `POST /terminal/panes/close`
(`pid pane close <scope>:<id> <paneId>`) closes one it opened itself.
`features/terminal/terminal-panes.core.ts` holds every decision;
`terminal-panes.io.ts` spawns and keeps the bookkeeping.

- **Ownership is the same derivation the poller uses, and a caller cannot name
  a session at all.** A request carries a `scope` and an `id`, never a zellij
  session NAME: `resolveOwnedSession` looks the name up in the daemon's own
  candidate list (`listPollCandidates`, the list `selectPollTargets` intersects)
  and requires `zellij list-sessions` to report it live and not EXITED. So a
  session the daemon did not derive cannot be asked for, rather than being
  filtered out afterwards. No name-shape heuristic exists anywhere in the path.
- **Two zellij verbs, by construction.** The only argv this slice can build are
  `action new-pane` and `action close-pane`. `kill-session`,
  `delete-session` and `kill-all-sessions` are not merely avoided — they cannot
  be produced, and a test asserts the built argv contains none of them.
- **The refusal matrix** (each reason is its own word, so a caller can branch;
  `refusalStatus` maps them to a status and the CLI to an exit code):

  | reason | status / `pid` | why |
  |---|---|---|
  | `not_derived` | 404 / 6 | the daemon never derived that scope+id |
  | `not_live` | 404 / 6 | derived, but no live zellij session by that name |
  | `cwd_missing` | 400 / 2 | see below — zellij would accept it silently |
  | `pane_budget` | 409 / 2 | the session already holds `MAX_PANES_PER_SESSION` terminal panes, so a further pane could not be classified by the poller — creating an unobservable pane is not a favour |
  | `not_created_here` | 409 / 2 | no bookkeeping record (a human's pane, or any pane created before the last daemon restart), or the live pane no longer carries the name the daemon minted |
  | `own_pane` | 409 / 2 | the caller's own pane; closing it would kill the caller mid-request |
  | `last_pane` | 409 / 2 | the session's only terminal pane — closing it leaves the session with zero panes, which is a teardown by another name |

- **`--cwd` is guarded by the daemon, not by zellij.** Verified against zellij
  0.44.3: `new-pane --cwd /does/not/exist` is ACCEPTED — it creates the pane and
  runs the command somewhere else, silently. A pane running in the wrong
  directory is worse than no pane, so `directoryExists` is checked (and must be
  a directory) before any spawn. The requested path is passed as zellij's `--cwd`
  ARGUMENT and never as `Bun.spawn`'s own cwd, because spawning into a
  nonexistent cwd has killed this daemon before.
- **Created-pane bookkeeping is in memory only, and that is the safe choice.**
  Pane ids are monotonic within a session and never reused (measured), so within
  one daemon lifetime an id identifies one pane — but a recreated session starts
  at `terminal_0` again, so a record that outlived the daemon could name a pane a
  human made. After a restart the daemon cannot know it created anything and
  refuses every close (`not_created_here`) rather than guessing. Identity is
  therefore id AND minted name: `--name pid-pane-<n>` survives a program setting
  its own OSC title (also measured), so `decideClosePane` requires the live
  `list-panes` row for that id to still carry it.
- **Self-close is refused, not honoured.** `pid pane close` sends the caller's own
  `ZELLIJ_PANE_ID` / `ZELLIJ_SESSION_NAME` (read in `apps/cli/src/agent/main.ts`,
  a sanctioned composition root). Both are untrusted by construction — they come
  from the caller's environment and can only ever make the daemon refuse, never
  let it do more — and `ZELLIJ_PANE_ID` is a bare number inside a pane while
  `list-panes` speaks `terminal_<n>`, so `normalizePaneId` accepts both spellings.
- Closing a pane that has already gone is a success (`ok: true, closed: false`),
  not an error: the state asked for is the state that holds. The record is dropped
  either way, so a second close is `not_created_here`. A zellij failure keeps the
  record (retryable) and answers 502 with only the FIRST LINE of zellij's output,
  bounded to 200 chars — an unknown session makes `zellij action` print its whole
  session list, 60KB of it on the box this was written on.
- The write spawn hands the child the scrubbed environment (`childEnv` from the
  config funnel), unlike the read path. Not because `action` attaches (it does
  not) but because a write is where an ambient `ZELLIJ_SESSION_NAME` would be
  dangerous: if `--session` were ever dropped from an argv, a scrubbed
  environment makes that a loud failure instead of a pane opened in whatever
  session the daemon itself runs inside. It shipped without the scrub for exactly
  one reason — the value was not available without a seventh environment read in
  a file the axiom ratchet pins — and that is what the funnel change below fixed
  rather than waived.
- A created pane is classified like any other: its screen appears under
  `<scope>:<id>#<paneId>` (see the poller section above), and the create response
  hands that key back so a caller does not have to build it.

### The terminal slice reads no environment at all

`terminal.routes.ts` used to read the environment six times — the scrubbed child
env twice, `HOME` three times, `PID_ORCHESTRATOR_DIR` once — which is why it
carried the largest `env-outside-config` entry in `scripts/axiom-debt.json`. All
six are gone, and the ratchet's baseline dropped from 76 to 70 in a diff of its
own rather than as a drive-by:

- `platform/config.io.ts` gained `homeDir`, `orchestratorDir` and `childEnv`.
  Picking the Orchestrator repo path out of `PID_ORCHESTRATOR_DIR` and a home
  directory is a config decision; deciding whether that directory exists is not,
  so `resolveOrchestratorCwd` kept the check and now takes the resolved `dir`.
- `platform/child-env.ts` holds the zellij marker scrub, moved out of
  `terminal.core.ts`. The config funnel needs it to build `childEnv`, and a
  helper the funnel depends on cannot live inside a feature slice — that would
  point platform at a feature, and it made `features/dispatch/pi.io.ts` reach
  through the terminal slice's internals for an env helper.
- `platform/spawn-config.ts` hands the three values to the slice, read once at
  module load. Same shape and same reasons as `zellij-prefix.ts` beside it: the
  slice receives values, not a config dependency.
- Two pure helpers stopped taking env maps. `globalTerminalCwd({ homeDir })` and
  `resolveOrchestratorCwd({ dir, dirExists })` take the values they actually use,
  because an env-shaped parameter is I/O wearing a plain-object costume — it is
  what let a pure core be handed the whole environment in the first place.

The payoff beyond the ratchet: the pane write surface can now scrub the child
environment (see the bullet above), which it shipped without because the value
was unavailable at an acceptable price.

## State-change rules (`<claudeConfigDir>/pid-dashboard/rules.json`)

herdr's own docs leave "when a session does X, do Y" to shell scripting over
its CLI — there is no configuration-based trigger, no on-state-change action.
This repo already publishes every transition on the SSE bus and already has
the named-key vocabulary and the wait primitive, so a rules engine is the
layer neither tool covers: a session that goes `blocked` at 3am can page you,
and a session that finishes can kick off the next step.

**Both readings can trigger a rule.** A session has an independent supervisor
reading (`state.json`, republished as `session.state`) and screen reading (the
classifier's verdict on the pane, republished as `terminal.state`), and they
disagree in exactly the cases automation exists for: a permission prompt nobody
answers, a folder-trust dialog, a pane gone quiet while `state.json` still claims
`working`. `POST /sessions/:id/wait` lets an agent choose its reading with `via`
and `GET /sessions/:id/explain` reports when the two contradict each other — a
rule chooses by which key its `when` sets, `state` or `screen`. Every safety
property below applies identically to both.

**Safety is the feature, not a constraint bolted onto it:**

- **Disabled by default.** With no `rules.json` present, or with the file's
  top-level `enabled` absent or `false`, the engine never calls its own
  evaluator — not "evaluates and suppresses everything," genuinely never
  runs. The user opts in explicitly, once, in a file they wrote.
- **`keys` requires its own per-rule `confirm: true`.** Sending keys means
  typing into a live `claude attach` TUI a human may be watching — the same
  keystrokes `POST /sessions/:id/keys` sends (see "Named key vocabulary"
  above), sent by a machine instead of a person. There is no file-wide "allow
  keys" switch; a `keys` action missing `confirm: true` on ITS OWN rule still
  parses (so an author can build a rule up before turning the dangerous part
  on) but the engine refuses to fire it, reported as a `KeysNotConfirmed`
  suppression.
- **Two loop breakers**, both enforced in the pure core and tested there. Both
  evaluators (`evaluate` for the supervisor reading, `evaluateScreen` for the
  screen) route a matched rule through one source-blind `outcomeFor`, so the
  suppressions cannot diverge between the two readings — that is structural, not
  a promise:
  - A per-(rule, session) **cooldown** — `cooldownMs` on the rule, defaulting
    to 300000ms (5 minutes) when omitted — so a dwell rule re-checked on
    every tick cannot resend the same keystroke to a still-blocked session a
    hundred times.
  - A per-session **ceiling** — at most 5 actions across every rule combined
    within a rolling 600000ms (10 minute) window — the backstop for several
    distinct rules each individually respecting their own cooldown but still
    piling onto one session together.
  - A ceiling or cooldown trip is a first-class `Suppressed` outcome, not
    silence: it is recorded in the firing log and published on the bus the
    same as a real firing, because a silently-throttled automation is
    indistinguishable from a broken one.
- **A dry-run preview** (`POST /rules/preview`) evaluates both readings of every
  currently-known session against the rules file on disk and reports what
  would happen — fires nothing, calls no port, records nothing. It ignores
  the file's own top-level `enabled` gate (but not a rule's own `enabled`) so
  an author can test-drive a rules file before ever flipping automation on.
- **A pause switch** (`POST /rules/pause`) at runtime, mirroring
  `issue-driver`'s own `/pause` — suppresses every action, on either reading,
  without touching the file or losing the engine's tracked session state.
- Actions never touch a session the rule did not match, and a rule that
  matches nothing is not an error — it simply produces no outcome.

### File format — `<claudeConfigDir>/pid-dashboard/rules.json`

```jsonc
{
  "enabled": true,                       // required to actually fire anything; absent/false = fully off
  "rules": [
    {
      "name": "page-on-stuck-blocked",   // required, unique across the file
      "enabled": true,                   // optional, default true — a per-rule kill switch
      "when": {
        // EXACTLY ONE of `state` (the supervisor's reading) or `screen` (the
        // classifier's). Setting both, or neither, is a validation error.
        "state": "blocked",              // blocked | needs_input | done | failed | idle | unknown
        "forMs": 300000,                 // optional: present = dwell condition, absent = transition condition
        "harness": "claude",             // optional: claude | pi — restrict to one CLI's sessions
        "stale": true                    // optional boolean — match sessions-explain.core's own staleness verdict
      },
      "then": {
        "action": "notify",              // notify | keys | stop
        "message": "still blocked after 5 minutes"
      },
      "cooldownMs": 300000               // optional, default 300000, integer 0..86400000
    },
    {
      "name": "page-on-an-unanswered-permission-dialog",
      "when": {
        "screen": "blocked",             // working | blocked | idle | unknown — what the classifier read
        "matcher": "permission-prompt",  // optional: which classifier row fired
        "forMs": 120000                  // optional, same two readings as above
      },
      "then": { "action": "notify", "message": "nobody has answered this prompt in 2 minutes" }
    }
  ]
}
```

Wire field name note: the schema's action object is spelled `then` in this
document's prose (it reads naturally: "when X, then Y") but is named `do` on
the actual JSON wire and in `rules.core.ts` — Biome's `noThenProperty` lint
rule flags any object literal with a `then` key (thenable ambiguity), so the
real field is `do: { action, ... }`.

### Conditions (`when`)

A `when` names its trigger source by which key it sets, and the parser records
that as a derived `source: "supervisor" | "screen"` field on the parsed rule (so
`GET /rules` shows a reader which reading each rule watches, and so neither
evaluator can test a screen observation against a supervisor rule). Setting both
`state` and `screen`, or neither, is a validation error rather than a precedence
rule nobody would remember.

Fields belonging to the other source are rejected, not ignored: `matcher` on a
supervisor trigger, or `harness` / `stale` on a screen trigger, each produce
their own error. Silently dropping them is how an author ends up believing a rule
is narrower than it is.

#### Supervisor conditions

- **`state`** is required and is one of the six trigger states —
  deliberately narrower than the full eight-slug vocabulary: `working` is
  excluded (a session actively working needs no automation reacting to it)
  and so is `stopped` (that session was already ended deliberately, by a
  human or `pid stop`; nothing should react to that on its own).
- **Transition condition** (`forMs` absent): matches the instant a session's
  state becomes `state` and was not already `state` a moment before —
  including the very first time this daemon ever observes that session, so a
  session already sitting in `blocked` at daemon boot counts as "just
  entered blocked."
- **Dwell condition** (`forMs` present, an integer 1000..86400000ms): matches
  whenever the session is CURRENTLY in `state` and has held it for at least
  `forMs`, re-checked on every periodic tick (`PID_RULES_TICK_MS`, default
  30000ms; `0` disables the sweep). A dwell rule therefore depends on this
  engine's own tick staying alive — this daemon has previously lost its
  entire timer subsystem on a long uptime (see `sessions.io.ts`'s
  `ensureFresh` comment), so a dwell rule should never be the only thing a
  user relies on for something time-critical.
- **`harness`** (optional: `claude` | `pi`) restricts the rule to sessions of
  one CLI, mirroring `SessionState.harness`.
- **`stale`** (optional boolean) matches against the same staleness verdict
  `GET /sessions/:id/explain` computes (state claims an active slug but
  hasn't been updated in over 120000ms) — recomputed independently inside
  the rules engine from the same `session.state` bus payload, since the
  rules slice cannot import `sessions-explain.core.ts`'s internals (see
  below).

#### Screen conditions

- **`screen`** is required and is one of the four readings the classifier can
  report — `working` | `blocked` | `idle` | `unknown` (the vocabulary in
  `shared/src/terminal.ts`, a strict subset of the session states: a resting pane
  looks identical whether the session finished, failed or was stopped, so the
  classifier never claims to know which). Deliberately **not** narrowed the way
  the supervisor trigger list is, and `working` is why: "the screen has read
  `working` for four hours" is a stuck-loop condition no supervisor reading can
  express — `state.json` is not rewritten during a long turn, so even `stale`
  misses it — and it is the one rule the screen uniquely makes possible.
- **`matcher`** (optional) narrows the reading to ONE classifier row by name, from
  the eight in `shared/src/terminal.ts` (`permission-prompt`,
  `workspace-trust-prompt`, `thinking-gerund`, … — the same `matcher` field
  `GET /terminal/states`, the `terminal.state` event and `explain`'s `terminal`
  object already carry). This is what makes a rule about a tool-permission dialog
  a different rule from one about the folder-trust dialog, which matters most for
  a `keys` action: the same keystroke answers them differently. A name outside the
  vocabulary is a validation error, never a rule that silently never fires — a
  typo in a 3am pager rule should fail at parse time.
  - `matcher` combined with `screen: "unknown"` is rejected: `unknown` IS the
    absence of a matcher, so the pair describes a screen that cannot exist.
- **Dwell** works the same way as for a supervisor condition, measured against the
  screen's own anchor, which is independent of the supervisor's. This is the
  condition that actually matters for a screen rule: a prompt answered in two
  seconds needs no automation, one nobody has touched for two minutes does.
- **What a rule sees when the classifier flips to `unknown`.** `unknown` is a
  real, first-class reading — "no matcher fired", the absence of evidence — so it
  is a legal trigger and reaching it IS a transition: a dwell timer on the
  previous reading resets, and a `screen: "unknown"` rule fires. What does NOT
  happen is a matcher-scoped rule matching it: an `unknown` observation carries no
  matcher, so `{ "screen": "blocked", "matcher": "permission-prompt" }` stops
  matching the moment the classifier loses the thread, even though the pane may
  well still be blocked. That asymmetry is deliberate — a rule that sends
  keystrokes should act on evidence, not on the memory of evidence.
- **Matcher changes inside one reading are not observed.** The poller publishes
  `terminal.state` only when the STATE changes (`decideTransition` in
  `terminal-state.core.ts`; gating it any looser would mean an SSE event per
  spinner frame), so if a pane's matcher changes while its reading does not, the
  engine keeps the matcher it last saw. For `blocked` — the reading
  matcher-scoped rules are actually written against — that means a rule keys on
  whichever dialog first blocked the pane, which is also the one a human would
  answer first.
- **Rules act on the session row, not on pane rows.** A multi-pane session
  publishes one `terminal.state` row per pane on the same event, with an `id` of
  `<short>#<paneId>` (see "Unattended sessions" above). The engine skips those:
  a pane row's `id` is not a short, so a `keys` or `stop` fired for one would
  target a session that does not exist. No coverage is lost, because the
  session-level row already folds every pane into the most attention-worthy
  reading and carries the winning pane's own matcher — a prompt waiting in a
  second pane still triggers a rule, under an identity the action can address.
  `isTerminalPaneRowId` in `shared/src/terminal.ts` is the one place that
  distinction is spelled, since it is a wire fact both slices depend on.
- **Screen latency is the poll interval.** An unattended pane is classified once
  per `PID_TERMINAL_POLL_MS` pass, so a screen trigger fires up to one interval
  after the screen actually changed, and a dwell is accurate to the same
  granularity. A pane with a terminal WebSocket open is classified off its byte
  stream instead and is far quicker.

#### Dwell across a daemon restart

Every dwell anchor lives in memory, like the firing history and the engine's
whole picture of both readings. A restart loses all of it: each view is re-seeded
by the first event after boot — the session registry's own state replay for the
supervisor side, the first poller pass (within one interval) for the screen side
— with `stateEnteredAt` set to *now*. So a dwell rule starts counting from zero at
boot, and a pane that had been blocked for an hour needs its full `forMs` again
before anything fires.

That is deliberate, and it fails in the safe direction. Persisting anchors would
have a restart immediately fire every rule whose window had already elapsed —
while the cooldown and per-session ceiling that exist to stop exactly that came
back empty, because they are in memory too. Under-firing after a restart is
recoverable; a burst of `keys` actions with both loop breakers reset is not.

### Actions (`do`)

- **`notify`** — `{ action: "notify", message }`. Publishes a `notification`
  SSE event (`{ short, rule, message, at }`) for a future web toast/notifier,
  distinct from the `rules.fired` audit event every outcome already gets
  (see "SSE surface" below).
- **`keys`** — `{ action: "keys", sequence: NamedKey[], confirm: true }`. The
  same 15-name vocabulary "Named key vocabulary" above documents (no `text`
  steps, no `repeat` — just names), validated against the one `NAMED_KEYS`
  declaration in `shared/`; `api.ts` resolves the sequence to bytes through the
  same `parseKeysRequest` the HTTP endpoint uses, so a rule's keystrokes and a
  caller's take one code path rather than two encoders that could disagree.
  **`confirm: true` is mandatory to ever actually fire** — see "Safety" above.
- **`stop`** — `{ action: "stop" }`. Ends the session the supported way
  (`ShellIo.stop`, the same call `POST /sessions/:id/stop` makes).

### Answering a dialog automatically — the capability, and why it ships off

Nothing in this repo ships a rule that answers a permission prompt. The
capability exists and works; auto-approving a tool call on someone's behalf is a
decision for whoever owns the machine, so it is theirs to write, not a default.
There is no default rules file at all — see "Safety" above.

If that is what you want, this is the shape. It is spelled out here rather than
shipped so the trade-offs are visible before you copy it:

```jsonc
// <claudeConfigDir>/pid-dashboard/rules.json  — YOU write this file; nothing creates it
{
  "enabled": true,
  "rules": [
    {
      "name": "trust-my-own-worktrees",
      // Only the folder-trust dialog, never a tool-permission one: they render
      // different option lists, so one keystroke does not mean the same thing in
      // both. This is exactly what `matcher` is for.
      "when": { "screen": "blocked", "matcher": "workspace-trust-prompt", "forMs": 15000 },
      // `confirm: true` is what makes a keys action fire at all. Without it the
      // rule parses and is then refused as a KeysNotConfirmed suppression.
      "do": { "action": "keys", "sequence": ["enter"], "confirm": true },
      "cooldownMs": 60000
    }
  ]
}
```

What to weigh before enabling something like this:

- **A screen classification is a weaker claim than a supervisor state.** It says
  the pane looks like that, not that the agent reported it. Naming the `matcher`
  is what raises the confidence from "some dialog" to "this dialog", so a `keys`
  rule without one is close to sending a keystroke at a screen you have not read.
- **`forMs` is your safety margin.** A dwell of a few seconds means you only ever
  answer a dialog nobody was about to answer themselves, and it costs nothing but
  latency.
- **The dialog's own option order is not this repo's to guarantee.** `enter`
  accepts whatever option the CLI's cursor happens to sit on, and that is the
  CLI's UI, which changes between versions. Prefer an explicit selection
  (`["1", …]` is not available — the named-key vocabulary has no digits, so a
  digit needs `POST /sessions/:id/send`, which no rule action wraps) and re-check
  the behaviour after a CLI upgrade.
- **The loop breakers still apply**, and for a keystroke rule they are the
  backstop that matters: at most one firing per rule per session per
  `cooldownMs`, and at most 5 actions per session per 10 minutes across every
  rule.
- **Dry-run first.** `POST /rules/preview` (`pid rules preview`) reports what
  would fire against the sessions the engine can currently see, without firing
  anything and ignoring the file-wide `enabled` gate — so the honest order is:
  write the file with `enabled` absent, preview it, then flip it on.

### Validation

`parseRulesFile` collects **every** error in one pass, the same discipline
`parseFleetFile` uses: a bad `name`, an unrecognized `when.state` /
`when.screen` / `when.matcher` / `when.harness`, a `when` that sets both or
neither of `state` and `screen`, a field belonging to the other trigger source, a
`matcher` paired with `screen: "unknown"`, an out-of-range `when.forMs` /
`cooldownMs`, a malformed
`then`/`do` object for the declared `action`, an unknown key name in a `keys`
sequence, and duplicate rule names are all reported together, not
one-fix-rerun-see-the-next. A malformed `rules.json` (bad JSON, or JSON that
doesn't match the schema) is never a 500: `GET /rules` and `pid rules` both
surface it as an `errors` list — `pid rules` exits 2, the same code `pid
fleets` uses for an invalid recipe. An absent `rules.json` is not an error
either: `{ enabled: false, rules: [] }`, disabled.

### How the rules slice reaches vocabulary it does not own

`features/rules/` may not import `features/sessions/`'s or `features/terminal/`'s
internals: `sessions.core.ts`, `sessions-keys.core.ts`,
`sessions-explain.core.ts` and `terminal-state.core.ts` are slice internals, not
published doors, and `bun run axiom-debt`'s cross-slice-import counter fails the
build on any NEW violation. Two mechanisms get the slice what it needs without
one:

- **Vocabulary comes from `shared/`.** `rules.core.ts` imports the session-state
  slugs, the named keys, the staleness threshold and — for screen triggers — the
  terminal-state slugs and the classifier's matcher names from `@pid/shared`,
  which a pure core may import at zero debt. The screen vocabularies moved there
  in this feature's own PR for exactly that reason, and `terminal-state.core.ts`
  now imports them back: its `Matcher.name` IS the shared union, so a row named
  off-vocabulary is a type error, and a co-located test closes the other direction
  (a published name with no row behind it). The alternative — a literal copy
  behind a drift guard — is the pattern `shared/` exists to delete; see the
  "Contracts live in `shared/`" axiom above for the five copies it already
  retired.
- **Observations come off the SSE bus.** The engine's picture of what every
  session is doing (`features/rules/rules.io.ts`) is built entirely by decoding
  `session.state`, `session.removed` and `terminal.state` payloads off
  `platform/sse-bus` — it never queries the sessions or terminal slices. That
  works because `terminal.routes.ts` already publishes every classification there
  through its single writer `publishTerminalState`, so the screen reading needed
  no new plumbing at all: one more `event.type` branch and a defensive decoder
  (`decodeTerminalStatePayload`, `undefined` on anything unexpected, never a
  cast). Screen views are kept in their own map keyed by session short, not folded
  into the supervisor view — a `terminal.state` payload carries no supervisor
  state or harness, and the two readings have independent dwell anchors, which is
  the entire point.

Ports (`notify`, `sendKeys`, `stop`, `now`) are injected plain-Promise functions,
exactly like `fleet-run.io.ts`'s `FleetRunPorts`; `api.ts` (outside any slice, so
free of the ratchet) wires the real `ShellIo` / `sse-bus` implementations into
them.

### Endpoints

- `GET /rules` — `{ enabled, paused, errors, rules, log }`: the parsed rules
  (empty when the file is invalid), every validation error, whether the
  file/engine is enabled, whether it's currently paused, and the recent
  firing log (bounded to the last 200 entries — fired AND suppressed).
- `POST /rules/pause` — body `{ paused?: boolean }` (default `true`, same
  contract as `POST /issue-driver/pause`) — `{ paused }`.
- `POST /rules/preview` — `{ errors, outcomes }`: evaluates every
  currently-known session against the on-disk rules file and reports what
  would fire and what would be suppressed (and why) — fires nothing.

### CLI and SSE surface

`pid rules [--json]` lists the parsed rules, validation errors, and
enabled/paused state; `pid rules preview [--json]` runs the dry-run above.
One line per rule, in file order, columns `name  source  <trigger>`:

```
state-change rules: enabled

  answer-permission  screen      blocked  permission-prompt  for 2m
  nudge-stale        supervisor  blocked  for 5m
```

The `source` column is the rule's derived `when.source` — which reading fires
it — and the trigger that follows is the state or screen slug, the matcher when
the rule names one, and the dwell when it has one. Without those columns two
rules watching *different* readings of the same slug print identically, which
is the whole distinction an author needs to check. The CLI parses that trigger
tolerantly: a `when` shape it cannot read costs those columns on that one line
and never the listing, so a CLI older than the daemon still answers. `--json`
passes `GET /rules` through verbatim.

Both exit 2 on an invalid rules file, the same as `pid fleets` — see AGENTS.md
"Exit codes" below (2 already means "an invalid recipe file," broadened here
to cover an invalid rules file too; no new code was introduced).

`rules.fired` joins the SSE event union (see "API surface" above): published
once per outcome the engine's `evaluate` produces — fired AND suppressed —
carrying the same shape `GET /rules`'s `log` array does
(`{ _tag: "Fired" | "Suppressed", rule, short, action, reason?, at }`). This
is the daemon's own audit trail for "why did/didn't this rule fire," separate
from the human-facing `notification` event a `notify` action publishes.

## Single-package CLI distribution (`pid-dashboard`)

`apps/cli` publishes the whole dashboard as one dependency-free package:
`bunx pid-dashboard` boots the daemon and the SPA on one port and opens the
browser — no separate `apps/web`/`apps/daemon` setup.

- `apps/daemon/src/api.ts`'s `buildApp(staticDir?)` composes the final request
  handler. With no `staticDir` (dev daemon, e2e) it's
  today's shape unchanged: the API at the bare root. With a `staticDir` (the
  CLI), the SPA owns the bare root instead — `features/static-web/` serves it
  with an SPA (history-API) fallback for extensionless paths — and the API
  moves behind `/__api`. This mirrors the same-origin prefix
  `apps/web/src/lib/apiBase.ts` already falls back to when there's no
  `VITE_API_URL` override (previously only exercised by the Cloudflare-tunnel
  dev proxy); the two paths were never composable before because API routes
  like `/sessions/:id` collide with identically-named SPA routes at the bare
  root — the prefix switch is what makes single-port serving possible at all.
  `/events` (SSE) stays unprefixed in both shapes; `mountExtensions(app)` must
  run BEFORE `buildApp()` — it mutates the pre-wrap `app`, and `.route()`
  snapshots a sub-app's routes at call time.
- `apps/cli/src/main.ts` is the `bin` entry (Bun runs `.ts` directly — no
  transpile step for dev). `bun run build:cli` (root script) builds
  `apps/web` with no `VITE_API_URL` (same-origin), copies its `dist` into
  `apps/cli/dist-web/`, then `bun build --target bun` bundles `main.ts` +
  `@pid/daemon` + every dependency into one `dist/main.js` — the published
  package's `dependencies` are empty; `@pid/daemon` is a `devDependency` used
  only for monorepo dev/typecheck.

## Agent-facing CLI (`pid`)

`apps/cli` ships a second, independent binary alongside `pid-dashboard`: `pid`
is a control surface an agent drives itself, so an agent running inside one
pane can spawn helpers, send them input, and wait on them, composing `pid` in
a shell the same way it composes any other CLI. The daemon itself teaches this
surface: `GET /agent-skill.md` (`<base>/agent-skill.md`) serves a markdown
instruction file covering `pid`, the HTTP endpoints beneath it, the named-key
vocabulary, wait semantics, `explain`, and a fan-out/join `spawn` recipe (see
"API surface" above; `apps/daemon/src/platform/agent-skill.ts`).

- Entry point `apps/cli/src/agent/main.ts`, pure logic in
  `apps/cli/src/agent/agent.core.ts`. Same layout discipline as the rest of
  the repo: `parseAgentArgv` and every exit-code/formatting/parsing decision
  live in the core with co-located tests; `main.ts` only reads argv/env/clock,
  drives the typed `hc` client against `@pid/daemon`'s `AppType`, prints, and
  exits with the code the core decided. `bin.pid` in `apps/cli/package.json`
  points at `dist/agent/main.js`; `bun run build` (in `apps/cli`) now bundles
  both entrypoints (`bun build ./src/main.ts ./src/agent/main.ts …`), and `bun
  build` preserves each entry's own subdirectory under `dist/`, which is why
  the agent binary lands at `dist/agent/main.js` rather than colliding with
  `dist/main.js`.
- `SessionStateSlug` (the 8-slug vocabulary) and the named-key vocabulary are
  **mirrored as literal copies** in `agent.core.ts`, not imported from
  `@pid/daemon`: the daemon package's `exports` map only publishes `.`,
  `./server` and `./types` (the Hono `AppType`), and a deep import of a
  slice-internal module (`sessions.core`, `sessions-keys.core`) does not
  resolve from `apps/cli` (`tsc --noEmit` fails with "Cannot find module").
  Keep both mirrors in sync by hand if the daemon's vocabularies change.

### Commands

```
pid sessions [--state <slug,...>] [--json]
pid explain <short> [--json]
pid terminals [<scope>:<id>] [--json]
pid wait <short> [--until <slug,...>] [--until-output <text> [--anchor <where>]]
         [--via supervisor|screen|either] [--timeout <ms>] [--json]
pid send <short> <text...> [--wait <slug,...>] [--timeout <ms>] [--json]
pid keys <short> <name...> [--wait <slug,...>] [--timeout <ms>] [--json]
pid spawn <intent> [--n <count>] [--agent <name>] [--cwd <path>] [--wait <slug,...>] [--json]
pid stop <short>
pid rm <short>
pid fleets [--project <id>] [--json]
pid fleet run <name> [--project <id>] [--dry-run] [--wait] [--json]
pid fleet runs [--project <id>] [--json]
pid rules [--json]
pid rules preview [--json]
pid [--help] [--url <base>]
```

- `--json` is accepted on **every** command, including `stop`/`rm` (a
  deliberate superset of the table above, for a uniform machine-readable
  path) — it prints the daemon's own response verbatim; without it, output is
  formatted for a human. For `pid sessions`, "verbatim" means the original
  daemon JSON objects (every field, not just the ones this CLI parses),
  filtered down to the shorts that matched `--state` — never a re-serialized,
  trimmed reconstruction.
- `--url <base>` and `--help`/`-h` are recognised **anywhere** in the
  invocation (`pid --url http://h:1 sessions` and `pid sessions --url
  http://h:1` are equivalent), independent of the subcommand grammar below.
  An empty invocation or one carrying `--help`/`-h` always resolves to help,
  exit 0 — asking for help is never a usage error.
- Base URL resolution, in order: `--url` flag, then the `PID_URL` environment
  variable, then the default `http://localhost:8787`. The CLI then probes
  `GET <url>/health`: success selects that URL as the API base (the dev
  daemon's bare-root layout); failure assumes the `pid-dashboard` single-port
  layout and appends `/__api` (see "Single-package CLI distribution" above)
  without a second probe — a second probe would only delay the same failure
  the real request goes on to report.
- `pid send <short> <text...>` and `pid keys <short> <name...>` join their
  trailing positional words with a single space / treat each as one named key
  respectively (`pid keys ab12 down down enter` sends `down`, `down`, `enter`
  in order — repeat by repeating the name). `pid spawn <intent>` similarly
  joins every positional word into the intent, so none of the three require
  quoting a multi-word argument. `--wait` on `send`/`keys`/`spawn` reuses the
  daemon's pinned-occupant wait (see "Server-owned waits" above) after the
  action; `pid wait` is the same wait as its own subcommand. `--timeout` is
  milliseconds; omitted, the daemon's own default (30s, capped at 10 minutes)
  applies. The `--wait` on `send`/`keys`/`spawn` takes slugs only and stays the
  supervisor wait it has always been — `--via` / `--until-output` live on
  `pid wait`, where the condition is the whole point of the command.
- `pid wait` needs **at least one** condition and accepts both; supplying both
  means "first to fire wins", the daemon's own composition rule.
  - `--until <slug,...>` — the session-state condition, as before.
  - `--via supervisor|screen|either` — which reading may settle an `--until`
    wait (see "`via`: which observation settles the wait" above). Default
    `supervisor`, matching the daemon, so an existing invocation is unchanged
    on the wire: the CLI omits `via` entirely at the default. A satisfied wait
    **prints which observation settled it** (`ab12 reached "idle" via screen
    after 1234ms`), because "the pane looks idle" is a weaker claim than "the
    agent reported idle" and a caller acting on the answer needs to know which
    it got. Only `working`/`blocked`/`idle` have screen evidence at all, so a
    `--via screen` wait naming only `done`/`failed`/`stopped`/`needs_input`
    times out by construction. A `--via screen`/`either` wait will not settle
    itself from a screen reading older than 60s (`SCREEN_READING_MAX_AGE_MS`); it
    keeps waiting instead, so a timeout means "nothing current said so", not "it
    never will". Reach for `pid explain <short>`, whose `read`/`unchanged` ages
    show exactly how old the pane's reading is, when a screen wait times out
    against a session you expected it to settle on.
  - `--until-output <text> [--anchor anywhere|line-start|line-end|line]` — the
    screen-text condition, a **literal** substring capped at 200 characters
    (never a regex — see "`untilOutput`" above for the ReDoS argument). Both
    the cap and the anchor vocabulary come from `@pid/shared`, the same
    declaration the daemon parses the request body with, so a pattern this CLI
    accepts is one the daemon accepts; rejecting here as well is not a second
    opinion, it is an earlier one (exit 2 instead of a round-trip and a 400).
    `--anchor` without `--until-output` is a usage error rather than a flag
    that silently does nothing. A pattern match prints and returns the line it
    appeared on (`matched`), and carries no state — there is none to report.
  - On a daemon with the screen poller off (`PID_TERMINAL_POLL_MS=0`) an
    `--until-output` wait exits **8** immediately off the daemon's own
    `409 screen_polling_disabled`, never 3. That distinction is the reason 8
    exists: an agent that reads "misconfigured daemon" as "the pattern has not
    appeared yet" retries until its own deadline.
- `pid spawn --n <count>` issues `count` independent `POST /dispatch` calls
  with the same intent/agent/cwd, each producing its own short; with `--wait`,
  each spawned short is waited on independently and every attempt's outcome
  (dispatch failure or wait outcome) is printed.
- session states: `done`, `working`, `blocked`, `needs_input`, `idle`,
  `failed`, `stopped`, `unknown`. Key names: `escape`, `enter`, `tab`,
  `shift-tab`, `up`, `down`, `left`, `right`, `home`, `end`, `page-up`,
  `page-down`, `backspace`, `delete`, `space` (the same deliberately-closed
  vocabulary as `POST /:id/keys`, so `ctrl-z`/`ctrl-c` are rejected here too).
- `pid explain <short>` prints the screen's own reading as its second block,
  not only in `--json`: a `screen:` line carrying the classification, the
  matcher that fired, the line it matched and how old the observation is
  (`screen: not classified` when the poller has never seen the pane — itself a
  diagnosis, since a `--via screen` wait on that session has nothing to resolve
  against). When the daemon reports `screenDisagrees`, a `!! screen disagrees:`
  line sits directly under the header, above everything else: it is the
  strongest evidence the command has, and it used to be reachable only by
  reading to the end of the reason list or parsing `--json`. The daemon still
  spells the contradiction out in full among `reasons` — that line is the
  headline, the reason is the argument. `screenDisagrees` is never recomputed
  here: the daemon owns the table of which screen state agrees with which
  session state (`SCREEN_AGREES_WITH`), and a second implementation would be a
  second answer. That headline attributes the claim to `source`, not to the
  literal string `state.json` — `pid explain <pi-short>` works now, and a pi run
  has no `state.json` to blame.
- `pid terminals` reads `GET /terminal/states` — the screen classification
  ("Terminal agent-state detection" above) for every terminal the daemon has
  looked at, whether over an attached WS bridge or the unattended poller. It
  answers a different question from `pid sessions`/`pid explain`: those report
  the *roster's* state for work the daemon spawned, while this reports what the
  *pane* shows, which is the only way an agent can see a `claude` or `pi` a
  human started by hand. States are the four screen slugs (`working`,
  `blocked`, `idle`, `unknown`), never the 8 session slugs.
  - Each row prints BOTH of the reading's ages — `for 2h` (how long that
    terminal has looked like this) and `read 7s` (how long ago the daemon last
    read the pane) — because a listing that shows only one of them is where this
    surface last lied: the single age column was the dwell, so 38 of 51 rows
    looked two hours stale while the poller was dumping those panes every 15s.
    A row reading `idle  for 2h  read 7s` is current evidence about a pane that
    has been resting all morning.
  - With no argument it prints every terminal, one row per key. With a
    `<scope>:<id>` key (`session:ab12`, `project:my-app`, `global:global`,
    `orchestrator:orchestrator` — `terminalStateKey` in
    `terminal-state.core.ts`) it prints just that one. The scope is
    **mandatory**: shorts, project ids and the two fixed terminal names share
    one key namespace, so a bare `ab12` would make the CLI guess — it is a
    usage error (exit 2) instead.
  - A key the daemon has never classified exits **6**, not a synthesized
    `state: "unknown"`. `unknown` is a real classification (the screen was read
    and no matcher fired); an absent key means nobody has looked yet — poller
    off, never attached, or the short is simply wrong — and an agent needs that
    distinction to choose between retrying and giving up. The endpoint kicks a
    stale poll pass fire-and-forget, so its own response predates that pass:
    a 6 for a session spawned seconds ago is worth one retry, which is what
    the stderr line says.
  - `--json` prints the daemon's own map verbatim, narrowed to the matched
    keys — a map even for a single key (and `{}` plus exit 6 when it missed),
    so a `jq` pipeline reads one shape regardless of arguments.
- `pid fleets` lists a project's `.pid/fleet.json` recipes (see "Fleet
  recipes" above) via `GET /projects/:id/fleets` — schema + validation +
  wave planning only, never spawns anything. `--project` defaults to the
  current directory's basename (a project id IS its directory name under the
  daemon's `projectsRoot`), so the default only resolves correctly when
  `pid` runs on the same machine as the daemon; pass `--project` explicitly
  otherwise. A non-empty `errors` list in the response exits 2, making `pid
  fleets` a linter an author can run before trusting a recipe. The same
  `--project` default applies to `pid fleet run`/`pid fleet runs` below.
- `pid fleet run <name>` executes a recipe by name (see "Executing a run"
  above) via `POST /projects/:id/fleets/:name/run`. `--dry-run` reports the
  plan without spawning anything — the safe default to reach for before
  committing real quota to a recipe. Without `--dry-run`, spawning starts in
  the background and the command returns immediately with the started run's
  id, unless `--wait` is given, in which case it polls `GET
  .../fleet-runs/:runId` to completion and prints the final run summary.
  `pid fleet runs` lists every run started for a project via
  `GET /projects/:id/fleet-runs`.
- `pid rules` lists the state-change automation rules in
  `<claudeConfigDir>/pid-dashboard/rules.json` (see "State-change rules"
  above) via `GET /rules` — off by default, so this is safe to run at any
  time. Each line names the rule's trigger (`source`, then the state or screen
  slug, the matcher and the dwell) so a screen rule is distinguishable from a
  supervisor one at a glance. A non-empty `errors` list exits 2, the same
  linter contract as `pid fleets`. `pid rules preview` evaluates every
  currently-known session
  against the file via `POST /rules/preview` and reports what would fire —
  it never spawns, sends keys, or stops anything.

### Exit codes

An orchestrating agent composes `pid` in a shell
(`pid wait ab12 --until done && pid send cd34 "next step"`), so the exit code
*is* the API:

| code | meaning |
|---|---|
| 0 | success / wait satisfied |
| 1 | transport failure, 5xx, unreachable daemon, or a response this CLI's parser could not make sense of |
| 2 | usage error (unknown command, missing argument, bad slug, unknown key name) — or an invalid recipe file / a cap-exceeded `pid fleet run` request, or a refused `pid pane` request (`cwd_missing`, `pane_budget`, `not_created_here`, `own_pane`, `last_pane`) |
| 3 | wait timed out |
| 4 | `occupant_changed` — the session was replaced under the wait |
| 5 | `removed` — the session went away |
| 6 | not found — the daemon returned 404, or `pid terminals <scope>:<id>` found no entry for that key, or a `pid pane` target this daemon never derived (`not_derived`) or whose zellij session is not running (`not_live`) |
| 7 | `pid fleet run --wait`: the run finished with a failed or skipped step, or the daemon refused to start it because that fleet already has an active run |
| 8 | `screen_polling_disabled` — `pid wait --until-output` against a daemon whose screen poller is off (`PID_TERMINAL_POLL_MS=0`), off its own `409`. Deterministic: retrying cannot help until the daemon is reconfigured, which is exactly why it is not 3 |

`pid spawn --n <count> --wait` runs `count` independent spawn+wait attempts
and reports the **worst** outcome across all of them as the process exit
code. Worst is ranked by how much the outcome degrades the caller's picture
of what happened, most severe last: `0` (ok) < `3` (timeout — it's out there,
just slow) < `4` (occupant changed) < `5` (removed) < `6` (not found) < `7`
(a fleet run's own rolled-up "did not run cleanly" verdict — see "Executing a
run" above) < `1` (transport/unexpected failure — the caller does not know
what happened at all) < `8` (a disabled poller: the one outcome here that
retrying cannot change, so when several attempts disagree it is the finding
the caller has to act on) < `2` (usage error, which in practice never mixes
with the others since it always short-circuits before any request is made).
`pid fleet run` itself never calls `worstExitCode` (each run only has one
outcome), but 7 sits at this point in the ranking so the severity table
stays total.

### Spawn-time discovery (`PID_URL`, `PID_SKILL_URL`, `PID_BIN`)

Everything above only ever got used when a human pasted instructions into a
session: nothing told a spawned session which port the daemon bound, and the
`pid` binary was on no PATH it could see. Every session the daemon spawns now
carries three variables — `PID_URL` (the daemon's root url, what `pid --url`
takes), `PID_SKILL_URL` (this daemon's own `/agent-skill.md`, prefixed
correctly for how *this* process serves the API) and `PID_BIN` (absolute path
to a runnable `pid`) — plus a shim at `<claudeConfigDir>/pid-dashboard/bin/pid`
that `PID_BIN` points at.

`platform/agent-discovery.core.ts` builds all of it as plain data;
`platform/agent-discovery.io.ts` resolves the `pid` command, writes the shim
and holds the one snapshot both dispatch paths read; `server.ts` arms it AFTER
`Bun.serve` so the url is the port actually bound (`--port`, `PORT` and
`port: 0` are all correct) and with `API_PREFIX` when a `staticDir` moved the
API — under the single-port layout the SPA owns `/` and 404s
`/agent-skill.md`, so the bare path would be a dead url. Until armed, the
snapshot is `undefined` and every spawn is byte-identical to what it was
before this existed.

**The two spawn paths need different carriers, and this is not a style choice.**
`claude --bg` does not run the session as its child: the supervisor claims a
pre-warmed `claude bg-spare` process whose environment predates the dispatch
(`ps` shows the pool; a spare's env is the supervisor's). Verified live — a var
set on the `claude --bg` invocation is invisible inside the session, while the
same var passed as `--settings '{"env":{…}}'` is visible, and the supervisor
records that flag in `respawnFlags`, so it survives a respawn. So the claude
path carries discovery as settings JSON on argv (`claudeDiscoveryFlags`, placed
before the variadic `--tools` and its `--` terminator), and the pi path — whose
zellij session the daemon spawns itself with an env it builds byte-for-byte —
carries it as ordinary env plus a PATH prepend (`discoveryChildEnv`).

**PATH is honestly one-sided.** In a pi pane the shim dir is on PATH, so the
bare name `pid` resolves. In a claude background session it cannot be:
settings `env` values are literal (verified — `${PATH}` arrives as the four
characters `${PA…`), so the only way to add a directory would be to overwrite
the whole variable with a value this daemon guessed, which would change how an
existing spawn behaves. `"$PID_BIN"` is the contract there, and the skill
document tells an agent the one-line `export PATH="$(dirname "$PID_BIN"):$PATH"`
if it wants the bare name. Nothing is ever written outside
`<claudeConfigDir>/pid-dashboard/` — a symlink into `~/.local/bin` would be a
machine-wide install the user never asked for.

The shim resolves the invocation for whichever install shape is running, in
order: this monorepo checkout (`bun apps/cli/src/agent/main.ts`), the packed
`pid-dashboard` bundle (`bun <dist>/agent/main.js`, the sibling `bun build`
emits for `bin.pid`), then an already-installed `pid` on the daemon's own PATH
(a global install, or `bunx pid-dashboard`, which puts the package's bins
there). It execs through `process.execPath`, so the session does not need `bun`
on its PATH. If none resolve, or the shim cannot be written, `PID_BIN` is
absent and the url variables are still published — a session then talks HTTP
rather than being handed a path that does not run.

**`PID_AGENT_POINTER=1` (default off)** adds ONE sentence to a dispatched
claude session's *system* prompt (`--append-system-prompt`) naming the skill
url and `PID_BIN`. Env vars and a shim are inert until an agent looks for them,
and an agent that was never told has no reason to look — the pointer is what
actually closes that loop — but it changes what every session this daemon
spawns is told, so it is opt-in and the user's own prompt is never touched. pi
has no `--append-system-prompt` equivalent, so the pointer is claude-only.

## Frontend skeleton

```
apps/web/src/
├── routes/                  # TanStack Router (file-based)
│   ├── __root.tsx           # shell: dispatch bar + <Outlet/>
│   ├── index.tsx            # grid of session cards
│   └── sessions.$id.tsx     # drill-in: full transcript
├── features/
│   ├── sessions/            # Card, Grid, hooks
│   ├── dispatch/            # DispatchBar
│   └── transcripts/         # JSONL renderer
├── lib/
│   ├── api.ts               # hc<AppType>(VITE_API_URL)
│   ├── sse.ts               # /events → queryClient patcher
│   └── query-client.ts
├── main.tsx
└── styles.css
```

Data flow:

```
EventSource(/events) ──> sse.ts ──> queryClient.setQueryData
                                          │
       hooks read cache ──> <Card/> grid, <Drill-in/>, <DispatchBar/>
                                          │
       mutations ──> hc.dispatch.$post, hc.stop.$post, hc.rm.$post
```

- `sse.ts` opens one `EventSource` at root mount; reconnects with `Last-Event-ID`.
- `import.meta.env.VITE_API_URL` with fallback `http://localhost:8787`.
- Vitest, co-located, exercises hooks with `QueryClientProvider` wrapper.
- `features/fleet/` (project dashboard "Fleets" tab — see "Fleet recipes"
  above): `useFleets`/`useFleetRuns`/`useRunFleet` over the typed RPC client,
  `FleetPanel` (query wiring) → `FleetView` (presentational, mirrors the
  `pid-settings` Panel/View split) → `FleetRunView` (one run's per-step
  status). `fleetParse.ts` decodes every wire shape from `unknown` rather than
  casting `.json()`; `fleetFormat.ts` holds the plan/run-rollup/tone helpers.
  `sse.ts`'s `fleet.run` listener keeps `useFleetRuns`' cache fresh the same
  way `terminal.state` keeps `useTerminalState` fresh.

## Decisions

### 1. Session state — adopt supervisor's states verbatim

```
Working      ← animated, actively running
Needs input  ← yellow, waiting on question/permission
Idle         ← dimmed, finished its turn, ready for next prompt
Completed    ← green, task finished
Failed       ← red, ended in error
Stopped      ← grey, Ctrl+X or `claude stop`
```

Process-aliveness shape modifier (informational, no transitions):
- `✻` alive — responds immediately
- `∙` exited — supervisor restarts on attach/peek/reply
- `✢` `/loop` sleeping between iterations (show run count + countdown from `state.json`)

The daemon does not model transitions. The supervisor is the state machine; we mirror.

A slug the supervisor emits that isn't one of the states above no longer
silently becomes "Idle" — it surfaces as its own `unknown` state, with the
raw slug preserved on `degradedFrom` so a supervisor upgrade, a typo, or a
future state this build predates shows up as an honest question mark instead
of a plausible-looking idle session. `GET /sessions/:id/explain` is the
provenance surface for all of this: it reports where a session's `state` came
from (its own state.json vs a roster-only seed ahead of the first read), how
stale that read is, whether the worker's pid is still alive, and — when the
slug is `unknown` — what the raw value actually was.

#### `explain` cites the screen (`features/sessions/sessions-explain.*`)

Provenance from `state.json` alone can only ever report what the supervisor
said about itself. The polled screen classification is a second, independent
observation, and `explain` now reports it alongside:

- `terminal: { state, matcher, evidence, readAgeMs, unchangedForMs } | undefined`
  — the pane's last classification, which rule fired, the exact line it matched,
  and BOTH of the reading's ages: `readAgeMs` is how long ago the pane was read
  (how fresh this evidence is), `unchangedForMs` is how long it has been reading
  this way. `undefined` when the poller has never classified this session's
  terminal. The reason sentence spells the pair out too — "read 7000ms ago,
  unchanged for 7200000ms" — because the single "observed <age> ago" it replaced
  reported the dwell and made current evidence look abandoned.
- `screenDisagrees: boolean` — whether that reading actually contradicts
  `state`, plus a `reasons[]` sentence naming both slugs and the matcher when
  it does. This is the `4d76edc1` case: `state.json` said `working` for 24
  hours while the pane sat at an empty prompt.

Agreement is decided by `SCREEN_AGREES_WITH`, a **mirror** of the web chip's
`AGREES_WITH` (`apps/web/src/features/terminal/terminalState.ts`), held to it
by `scripts/mirrored-constants.test.ts` — the two make the same judgement and
were tuned together against the live daemon, and neither app may import the
other. Its two load-bearing rows: a resting pane agrees with every not-running
state (`idle`/`done`/`stopped`/`failed`), because a finished session naturally
sits at its prompt; and `blocked` agrees with `needs_input`. An empty row —
`unknown` — asserts nothing and so can never disagree, which is why no matcher
firing is never grounds for calling the supervisor wrong.

Purity: `sessions-explain.core.ts` takes the screen as **plain input fields**
(`ScreenFacts`, whose `state` is a bare `string`), never importing
`../terminal/*`. The route reads the record through the same injected
`readTerminalState` port the waits use, and does the `Date.parse` itself so the
core keeps its no-clock rule.

One subtlety that only showed up against a real daemon: "no screen reading" is
not the same as "no screen record". A pi pane resting at its prompt was
classified `unknown` — a record present, no matcher fired, asserting nothing.
`screenAssertion()` is therefore the single definition of *did the screen say
anything*, and both the disagreement check and the pi no-corroboration reason go
through it. Keying either off the record's mere existence claims corroboration
that does not exist.

#### `explain` answers for pi too, and says what it cannot know

`explain` used to 404 for a pi short: the handler consulted only
`SessionRegistry.diagnostics()`, and a pi run is in no supervisor roster at all.
That left the one command built for trust blind to half the sessions this
dashboard spawns — and pi is where trust is scarcest, because **pi writes no
per-session `state.json`**. `PiSessionsApi.diagnostics()`
(`features/dispatch/pi-sessions.io.ts`) is the door that closes the gap; it
returns the same shape the registry does, so the route is a `??` and every
harness difference lives in the pure core where the sentences are written.

A pi session's `state` is not a report — it is the daemon's inference from the
tail of pi's transcript plus a probe of the pid recorded at spawn
(`derivePiState`). So the explanation refuses to imply file-based provenance,
and states the limits instead of omitting them:

| claude wording | why it would be a lie for pi |
|---|---|
| "state.json is no longer on disk" | pi never had one — already suppressed |
| "the supervisor respawns it on the next attach or peek" | nothing respawns a pi run; a dead pid means the run is over |
| "state.json has not been updated in Nms" | staleness is measured against pi's transcript, or the spawn record when pi has written no transcript at all |
| `state.json says "x"` in the CLI conflict headline | attributed to `source` now, so a pi run is credited to `pi-spawn-log` |

And three facts a pi explanation always volunteers:

- `blocked`/`needs_input` are **unreachable** for a pi run — `derivePiState`
  emits only `done`/`working`/`failed`, so a pi session at a permission prompt
  still reads `working` or `done`. Only the screen can show one waiting.
  `platform/agent-skill.test.ts` checks this claim against `derivePiState`
  itself over its whole input space, not against a string.
- `done` means the transcript's last entry is an assistant message, **not** that
  pi exited. Verified live twice: once with pi resting at its prompt, and once
  **mid-tool-call** — an assistant tool-use message is the last entry until the
  result comes back, so a busy pi reads `done` with the screen reading `working`
  and `screenDisagrees: true`. Never read a pi `done` as a finished run without
  `pidAlive` and the screen.
- `stateFilePresent` is always `false` and `lastEventAgeMs` always absent (the
  daemon keeps no event history for a pi short). Both are reported as the
  unknowns they are rather than quietly omitted.

### 2. Orchestrator role — dispatcher via `claude --bg`

```
[ Dispatch bar ]
  "fix bug in auth.ts"   n=[1▾]   [Spawn]
        │
        │ POST /dispatch { intent, n?, agent?, permissionMode?, cwd? }
        v
   dispatch.repo:
     for i in 0..n:
       spawn ["claude", "--bg",
              ...(agent ? ["--agent", agent] : []),
              ...(permissionMode ? ["--permission-mode", permissionMode] : []),
              intent], { cwd }
       read stdout line 1, parse "backgrounded · <id>"
     return [id1, id2, ...]
```

Filter syntax mirrored in the bar (same as `claude agents`):
- `a:<name>` — sessions running the named agent.
- `s:<state>` — by state (`s:working`, `s:blocked`).
- `#<pr-number>` or PR URL — session working on that PR.

`bypassPermissions` and `auto` must have been interactively approved at least once via `claude` before passing them through — the supervisor refuses otherwise.

### 3. Working directory per session — supervisor's job

`.claude/worktrees/<sess-id>/` is created automatically before the first file edit, removed on `claude rm <id>`. We do nothing. We do not reference these paths.

For non-git `cwd`, the supervisor falls back to direct writes — render a `⚠ no isolation` chip on those cards so the user sees the race risk before spawning siblings.

### 4. Persistence — none in daemon

Daemon is stateless across restarts. On boot:
1. Resolve config dir: `CLAUDE_CONFIG_DIR ?? ~/.claude`.
2. Watch `<configDir>/daemon/roster.json` — list of active session ids.
3. For each id, watch `<configDir>/jobs/<id>/state.json`.
4. Drill-in: read `<configDir>/projects/<encoded-cwd>/<id>.jsonl`.

The supervisor exits when idle; our file watchers stay attached to the paths and resume seeing changes when it next runs. `state.json` writes aren't atomic on all platforms — retry parse on transient errors.

### 5. Permission UX — reply via send/keys, not a documented supervisor IPC

`state.json` for a `Needs input` session contains the pending question or permission request. Card renders inline:
- tool name + input snippet (collapse-by-default for long Bash / Edit payloads)
- for `AskUserQuestion`: `questions[].options` rendered as radio/checkbox (read-only display — the daemon has no side channel to the supervisor's own render of the same menu, so this is a preview, not a control)

Available actions on a `Needs input` card:
- **Open in terminal** — copies `claude attach <id>` to clipboard.
- **Send keys** — `POST /sessions/:id/send` (raw `keys` string) or `POST
  /sessions/:id/keys` (named vocabulary: `escape`, `enter`, `tab`, arrows, …
  — see "Named key vocabulary" above) pty-attach and write into the
  supervisor's TUI. Answering an `AskUserQuestion` menu is
  `[{ named: "down", repeat: N }, { named: "enter" }]`, optionally with a
  `wait: { until }` to confirm the session left `needs_input` before the
  request returns.
- **Stop** — `POST /sessions/:id/stop` → `claude stop <id>`.
- **Delete** — `POST /sessions/:id/rm` → `claude rm <id>`.

There is still no documented supervisor IPC for external reply — `send`/`keys`
work by driving the attached TUI's stdin, the same as a human typing into
`claude attach`, not by talking to the supervisor directly. That remains the
project's main architectural constraint: every reply is a keystroke, not a
structured API call.

### 6. Card content — reuse supervisor's Haiku summary

`state.json.summary` is already a Haiku-class one-line activity string, refreshed at most every 15s plus on turn-end. Render verbatim. Do not synthesize our own — the supervisor's pass is already billed under the user's quota; doing it twice would double the cost.

Card layout:

```
+--------------------------------------------+
| <icon> <name>                  <state>     |
| <state.json.summary>                       |
| <state.json.last_output snippet>           |
| <cwd-tail> · <model> · <age> · <PR●>       |
|                                            |
| [Open] [Stop] [Delete]                     |
+--------------------------------------------+
```

PR-status dot color (from `state.json.pull_request`):
- Yellow — waiting on checks / review, or checks failed.
- Green — checks passed, no blocking review.
- Purple — merged.
- Grey — draft or closed.

For drill-in (`/sessions/$id`), read the JSONL with `getSessionMessages()` and render the transcript with tool-use / tool-result / assistant-text blocks.

## What this daemon does NOT do

- Spawn `query()` directly — the supervisor does.
- Create worktrees — the supervisor does.
- Hold `canUseTool` promises — no external SDK-level entry point exists for already-running supervisor sessions.
- Run Haiku summarization — the supervisor does.
- Persist anything — the supervisor + SDK FS do.
- Generate session IDs — the supervisor mints; we parse from `claude --bg` stdout.
- Track cost in a database — values are in the JSONL `ResultMessage`; surface only in transcript view.

## Claude Code surface area used

| Surface                                | How                                                                    |
| -------------------------------------- | ---------------------------------------------------------------------- |
| Spawn                                  | `claude --bg [--agent X] [--permission-mode Y] "<prompt>"`             |
| Spawn subagent as main                 | `claude --agent <name> --bg "<prompt>"`                                |
| Stop                                   | `claude stop <id>` (alias `claude kill`)                               |
| Restart stopped                        | `claude respawn <id>`                                                  |
| Restart all stopped                    | `claude respawn --all`                                                 |
| Remove session                         | `claude rm <id>` (cleans worktree if no uncommitted changes)           |
| Logs                                   | `claude logs <id>` (used only as transcript fallback)                  |
| List sessions                          | `<configDir>/daemon/roster.json`                                       |
| Live state                             | `<configDir>/jobs/<id>/state.json`                                     |
| Transcript                             | `<configDir>/projects/<encoded-cwd>/<id>.jsonl` via `getSessionMessages()` |
| Worktrees                              | `.claude/worktrees/<id>/` — auto-managed, no daemon involvement        |
| Config dir override                    | `CLAUDE_CONFIG_DIR` env var (read at daemon boot)                      |
| Disable check                          | If `disableAgentView=true` or `CLAUDE_CODE_DISABLE_AGENT_VIEW` set, surface a setup error |

## Deferred to v2

- **Programmatic reply / answer-question.** Watch for an official IPC. Fallback: `node-pty`-driven `claude attach <id>` → type → detach. Layered as v1.5 if IPC doesn't land.
- **Cross-device mirror.** v1 serves localhost only. v2: Cloudflare Quick Tunnel or `tailscale serve` integration; possibly a read-only mirror via `sessionStore` if it gains a remote backend.
- **Drawing / voice input** in the dispatch bar — browser-side; layers on top of `POST /dispatch`.
- **Inline PR diff viewer** — card already shows the PR-status dot; v2 embeds the diff.
- **Multi-machine roster aggregation** — show sessions from N machines in one view.
- **Quota / rate-limit warnings** surfaced on dispatch bar when roster size crosses a threshold.

## Risks to watch

- **Reply mechanism gap**: no documented external IPC. v1 ships read-only with attach-link fallback. Reassess when Claude Code exposes it or once `node-pty` fallback is engineered.
- **Supervisor file-layout stability**: `roster.json`, `state.json`, JSONL paths are documented but not contracted as a public API. Pin daemon to a tested Claude Code version range; warn on mismatch.
- **`CLAUDE_CONFIG_DIR` mismatch**: if the user sets it but the daemon doesn't read it, daemon watches the wrong tree. Read `process.env.CLAUDE_CONFIG_DIR` at boot.
- **State file races**: `state.json` writes are not atomic everywhere. Retry parse on `SyntaxError`.
- **Subscription quota**: parallel sessions consume quota linearly. v2 warning bar.
- **`disableAgentView`**: if the user / admin has turned off agent view, background sessions don't run. Daemon must detect and report cleanly.

## Worktree workflow

Agents working in a `.claude/worktrees/<name>/` copy must always:

1. **Branch from `origin/main`, not local HEAD.** Before starting work, `git fetch origin main` and base the worktree branch on `origin/main` so the diff reflects only the new change — never a stale local state. The harness's default `worktree.baseRef = "fresh"` already does this; do not switch it to `head`.
2. **Rebase onto `origin/main` before pushing.** If `origin/main` has advanced during the session, `git fetch origin main && git rebase origin/main` before opening the PR. Stop and resolve conflicts in the worktree rather than from the parent checkout.
3. **Open the PR against `origin main`.** `gh pr create --base main` (matches the auto-PR hook). Never target a feature branch or a fork; this repo's CI and merge queue run on `main`.

The auto-PR `Stop` hook (`.claude/settings.local.json`) enforces (3) for every commit made inside a worktree.

## Expertise Index

- [apps/daemon/src/features/global-settings](apps/daemon/src/features/global-settings/CLAUDE.md) — Global settings file + UI: git/library/orchestration/network params formerly hard-coded; field→consumer wiring map.
- [apps/daemon/src/features/dispatch](apps/daemon/src/features/dispatch/CLAUDE.md) — Dual-harness spawn (claude --bg / pi -p): pi launch-failure modes, detached-spawn stderr handling, pi session visibility.
- [apps/web/src/features/canvas](apps/web/src/features/canvas/CLAUDE.md) — Shared React Flow canvas, board-only (no session scratch canvas): sync field-dropping trap, edge-label editing, fitView/bezier e2e geometry.
- [apps/daemon/src/features/brainstorms](apps/daemon/src/features/brainstorms/CLAUDE.md) — Session-scoped board discovery: path-as-identity, three on-disk formats, why the surface hangs off the session and not the project.
- [apps/web/src/features/excalidraw](apps/web/src/features/excalidraw/CLAUDE.md) — Excalidraw boards: 0.18 ESM integration, restoreElements boundary, element-key sync dedupe, canvas-text-not-in-DOM e2e.
- [apps/web/src/features/sessions](apps/web/src/features/sessions/CLAUDE.md) — App-shell nav chrome: collapsed sidebar/rails must reserve zero width, reopen chips ride in existing rows, verify reclaimed space in pixels.
- [apps/e2e](apps/e2e/CLAUDE.md) — Playwright stub vs real-claude modes: pre-push runs real spawns (slow, env-sensitive), CI forces the stub.

<!-- CANON:START -->
## Engineering canon

Everything between the `CANON` markers is shared verbatim between `CLAUDE.md`
and `AGENTS.md`; `bun run doctor` fails the build if the two copies drift. Edit
both files together.

Every rule below is enforced by a tool. If you find yourself fighting one, fix
the design, not the linter.

### Architecture: feature-first vertical slices

Code is organized by **feature**, not by layer. Each slice owns its full vertical:

```
apps/daemon/src/
  features/<feature>/
    <feature>.core.ts        # PURE domain logic — no I/O, no Effect runtime
    <feature>.core.test.ts   # co-located unit test (data-in / data-out)
    <feature>.io.ts          # I/O as an Effect service (Context.Tag + Layer)
    <feature>.routes.ts      # Hono shell; impure read -> pure core -> respond
    <feature>.door.ts        # opt-in: the ONLY file another slice may import
  platform/                  # cross-cutting infra (runtime, config, ws, sse-bus)
  api.ts                     # assembles routes; exports AppType for hc RPC
  server.ts / main.ts        # composition root (Bun.serve, live Layers)
shared/src/                  # effect Schema wire contracts (doors re-export them)
apps/web/                    # Vite + React + TanStack Router (UI only) + Query
apps/cli/                    # `pid-dashboard` single-binary distribution
apps/e2e/                    # Playwright end-to-end suite
scripts/                     # the harness: gate scripts + their co-located tests
evals/                       # golden agent tasks; the repo's gates are the judge
```

`platform/` is for infra shared across slices. Anything feature-specific lives
in its slice. Anything a *second workspace* needs goes in `shared/`.

### The impureim sandwich (critical)

- **`*.core.ts` is pure.** Failures are values: `Either<A, E>`, `Option`, or a
  `Data` tagged union. Typed errors YES — but **NO** `throw`, no `await`, no
  `Effect` / `Layer` / `Context`, no clock, no environment, no I/O. `Either`,
  `Option`, `Data` and `Schema` from `effect` are allowed.
- **`*.io.ts` / `*.routes.ts` / `server.ts` use Effect.** Services are
  `Context.Tag`s, wiring is `Layer`s, the runtime is a `ManagedRuntime`.
- **Lift the core into Effect at the boundary.** A route reads I/O (impure),
  calls the pure core (the sandwich filling), responds. An `Either` returned by
  a core can be `yield*`-ed inside `Effect.gen` — a `Left` short-circuits as a
  typed failure.
- **`*.io.ts` is the slice's I/O port** (hexagonal sense) — any effectful
  dependency: subprocess spawn, filesystem, HTTP, clock. Not just persistence.
  That breadth is why the tier is named `io` and not `repo`, and it keeps the
  word "repo" free for what it means in this domain: a git repository.

Biome enforces this by file shape: in `**/*.core.ts` the imports
`Effect`/`Layer`/`Context` and any `*.io` or `*.door` module are banned, the
globals `Date` / `process` / `Promise` / `console` / `setTimeout` /
`setInterval` / `fetch` are banned, and three GritQL plugins
(`biome-plugins/`) ban `throw`, `await`, and 2+ positional parameters on a
declaration.

### Axioms, and the tool that enforces each

- **Failures are values in the core.** `biome-plugins/no-throw-in-core.grit`
  bans `throw`; `no-await-in-core.grit` bans `await`. Return
  `Either.left(...)` and let the shell decide whether that is a 400, a retry or
  a log line.
- **Co-located tests.** `*.test.ts` next to its source, never a `__tests__/`
  folder. `scripts/check-colocated-tests.ts` requires a sibling
  `*.core.test.ts` for every `*.core.ts` and rejects mirrored test directories.
  `scripts/check-feature-tests.sh` additionally requires every feature folder to
  ship at least one test.
- **TDD at three layers.** Pre-commit (`scripts/check-tests-touched.sh`) blocks
  a commit touching `apps/*/src/**` with no staged test — bypass with
  `SKIP_TDD=1` for docs/deps/config only. Pre-push runs the typecheck, the debt
  ratchet, the unit suites and the full Playwright suite, so a red branch never
  reaches the remote (`SKIP_E2E=1` to skip e2e). The PR e2e workflow re-runs
  Playwright and posts per-test screenshots as a sticky PR comment.
- **Everything type-checks.** `scripts/typecheck.ts` derives the project list
  from root `package.json` `workspaces` and runs `tsc --noEmit` on each; a
  workspace *without* a `tsconfig.json` is an error, not a skip. It reads
  `workspaces` rather than globbing `apps/*` for a concrete reason: `shared/` is
  a workspace and not an app, and under an `apps/*` scan it escaped both this
  gate and the debt ratchet. Whatever you must declare to make the repo install,
  you cannot exempt from the gates. `scripts/check-axiom-debt.ts` derives its
  scan roots the same way, and `bun run doctor` fails if either stops doing so.
- **No raw `fetch`, no `axios`.** `noRestrictedImports` bans `axios`
  repo-wide; the web app talks to the daemon through the typed Hono RPC client
  (`api = hc<AppType>` in `apps/web/src/lib/api.ts`). `*.io.ts` is the sanctioned
  place for a raw request.
- **Contracts live in `shared/`; the mirrors that survive are guarded, not
  silent.** A type two workspaces need is declared **once**, in `shared/src`, as
  an effect `Schema` — so the same declaration both types a call site and decodes
  an untrusted response (`decodeSessionState`, `decodeProject`,
  `decodeApiErrorBody`; `onExcessProperty: "error"`, so an undocumented field
  fails loudly instead of surfacing as `undefined` three components deep). Never
  hand-copy a daemon type into the web app. That is not a hypothetical:
  `SessionState` and `Project` were each declared twice, the second time in
  `apps/web/src/lib/types.ts` under a comment calling the copy a "local mirror",
  and both mirrors had already drifted — missing `worktreePath`,
  `worktreeBranch` and `lastCommitMs`, and typing nine nullable fields as
  required `string`. Nothing could have caught it, because there was no single
  declaration for the two copies to disagree with. Both web mirrors are gone;
  `apps/web/src/lib/types.ts` re-exports from `@pid/shared`.
- **Two declarations are fine when each has a job the other cannot do and
  something proves they agree. They are a mirror when nothing does.** That line,
  not the count, is the test to apply — and the two daemon-side pairs that remain
  sit on opposite sides of it, so the rule comes with worked examples.
  `SessionState` is declared twice on purpose: `shared/src/session.ts` models
  *wire* optionality (`S.optional`, because `JSON.stringify` drops an `undefined`
  key and the field never reaches the body), while
  `features/sessions/sessions.core.ts` keeps a strict producer type where every
  key is required, so a constructor that forgets one is a type error. Neither job
  is the other's, and `features/sessions/sessions.contract.test.ts` is the proof
  they agree — it JSON round-trips real `parseState` / `seedFromWorker` output
  through `decodeSessionState` and goes red on a daemon field the contract does
  not know about. `Project` fails both halves: `shared/src/project.ts` and
  `features/projects/projects.io.ts` declare the same ten fields with the same
  optionality, so neither is doing work the other cannot, and nothing compares
  them — drift surfaces only when the web app decodes a live response. That pair
  is a mirror, and naming it here is deliberate: a gap with an address gets
  closed, a gap acknowledged in general does not. Add the contract test or delete
  the duplicate; either way, do not add a third copy of either type.
- **`shared/` dissolved a deadlock the ratchet created.** A core that needed
  another slice's vocabulary used to keep a *literal copy* of it, because
  importing across slices is debt. Five such copies existed — the session-state
  slugs in `features/fleet`, `features/rules` and the CLI's agent core, the
  named-key list in `features/rules`, and the wait/staleness timings — each with
  a comment apologising for itself. Those five are gone:
  `shared/src/{session,keys,timing}.ts` holds one declaration each, importable
  from a pure core at zero debt. `scripts/mirrored-constants.test.ts`, the file
  that compared them, still exists and still runs, because two copies outlived
  the cleanup: the screen-vs-supervisor agreement table, duplicated between
  `features/sessions/sessions-explain.core.ts` and
  `apps/web/src/features/terminal/terminalState.ts` because neither workspace may
  import the other, and the zellij session name one slice mints while another
  resolves it. That file lives under `scripts/` so it can import both sides
  without adding cross-slice debt, and it is where an unavoidable copy earns the
  right to exist: a mirror with an assertion attached, not a mirror with an
  apology.
- **Contracts decode at the boundary.** `biome-plugins/no-cast-json.grit` bans
  `(await res.json()) as T` — a cast asserts a wire shape without checking it, so
  drift compiles forever and fails at runtime. Hand the decoded `unknown` to the
  shared `decode*` helper, or to a local pure parser for a shape that is
  genuinely one workspace's own. The ban covers **every** workspace; `bun run
  doctor` fails if its scope is narrowed, because the debt class that used to
  cover `apps/web` has been retired and nothing else is watching.
- **One error shape.** A failure crosses HTTP as `{ error: "<machine_tag>", … }`
  — the `ApiErrorBody` contract in `shared/src`. Tags are snake_case and stable;
  clients branch on them. A scaffolded slice maps its tags in a
  `STATUS_BY_ERROR` allowlist typed by its error union, so adding a failure mode
  without giving it a status is a type error rather than an inherited 500.
- **Typed config at boot.** `platform/config.io.ts` (plus `config-dir.ts` and the
  composition roots) is the one place that reads `process.env`. Slices receive
  values; they do not fetch them.
- **Log through the runtime, not `console`.** `noConsole` is an error outside the
  composition root and tests.
- **One parameter on declarations you design.**
  `biome-plugins/max-one-param-declarations.grit` bans 2+ positional parameters
  on named declarations — pass a single options object so the signature stays
  narrow as the implementation deepens. Scoped to `scripts/**` *and* to every
  `**/*.core.ts`: a shape, not a directory, so a new slice or a renamed app
  inherits it. Callback shapes a library dictates (`sort((a, b))`, Hono's
  `(c, next)`) are exempt by construction. `complexity/useMaxParams: max 2` is
  the floor everywhere.
- **Modules talk through doors, not back-channels (modular monolith).** A slice
  may import another slice's *published* door, never its internal files — and
  the door is a **file**: `<feature>.door.ts`, inside the slice that publishes
  it. Ownership stays with the module fronting the code, and it is the one
  cross-slice path `bun run axiom-debt` leaves open. It re-exports that slice's
  service `Context.Tag` and its interface type, plus the `shared/` `Schema`
  contract for the data crossing it, so a consumer has one import site and
  nothing else in the slice is reachable from outside. Naming the file matters
  more than it looks: with the boundary enforced but its shape unspecified, the
  template this canon comes from watched three models invent three conventions
  for the same task — a door in the slice, a door in `shared/`, and a narrowed
  port schema — so three PRs would have left three patterns behind.
  `bun run scaffold:slice <feature> --door` stamps one out. Opt-in, because a
  door nobody imports yet is an unused export that `fallow audit` calls dead
  code: publish one and wire the consumer in the same change. A pure
  `*.core.ts` may not import a door at all — a door re-exports a `Tag`, so
  consuming one would drag the Effect runtime into pure code past the ban on
  `effect` itself, and biome bans it by shape. Compose every module's live
  `Layer` into one process by default; a module becomes a separate deployment
  only under real pressure, and because consumers depend on the `Tag`, that
  split swaps a `Layer` at the composition root, not call sites. Design as if
  distributed; deploy as if together.
- **Conventional commits.** `type(scope)?: subject` — the lefthook `commit-msg`
  hook (`scripts/check-commit-msg.ts`) rejects anything else.
- **Dead code, cycles and duplication are audited.** `fallow audit`
  (`bun run audit`) runs in CI and pre-push, grading complexity and duplication
  against the committed snapshots in `.fallow-baselines/` so a large rename
  cannot re-attribute inherited debt to the PR that only moved filenames
  (`bun run audit:baseline` refreshes them).
- **Mutation tests grade the assertions.** `bun run test:mutation` mutates every
  `*.core.ts`; line coverage says a line ran, a surviving mutant says nothing
  asserted its behaviour. Weekly in CI, not per-PR — it costs minutes.
- **The bundle is built in CI, not only type-checked.** `verify` asks `tsc`
  whether the import graph type-checks; it never asks a *bundler* to resolve it,
  and those are different questions — `apps/web` imports `@pid/shared` at
  runtime, and tsc is happy with a workspace symlink a bundler might not be. The
  `build:cli (bundle resolves)` job builds the real distribution artifact on
  every PR, so a resolution failure surfaces there rather than at release time.
- **The supply chain is pinned and scanned.** Every `uses:` in every workflow is
  pinned to a full commit SHA — a tag is mutable, and whoever controls it
  controls what runs inside a job that already holds a token. `bun run doctor`
  checks pinning across **every** file in `.github/workflows`, discovered from
  disk, so a newly added workflow cannot skip the rule. The bun version lives in
  `.bun-version` and nowhere else. CodeQL and `zizmor` (workflow-security lint)
  run in CI; Dependabot proposes grouped weekly updates.

### Scaffold a slice; never hand-copy one

```bash
bun run scaffold:slice <feature>            # kebab-case
bun run scaffold:slice <feature> --door     # …plus its published door
```

Writes the five slice files in canonical shape (pure core + test, `Context.Tag`
io port with live *and* test Layers, Hono routes + test), mounts the route in
`api.ts`, and registers the live `Layer` in `platform/runtime.ts`. `bun run
verify` passes immediately afterwards, so any failure you then see is yours.
`--door` adds `<feature>.door.ts` on top — ask for it only when you are about to
wire the consuming import, since an unconsumed door is dead code.

A written recipe is advice and decays; every hand-copied slice drifts a little
from the last one. Generating the shape makes the canonical form the *cheapest*
one to produce. See `.claude/skills/add-slice`.

### Axiom debt is ratcheted, never waived

Three axioms are violated in bulk by code that predates their enforcement, so
turning them into hard lint errors today would fail CI: cross-slice internal
imports, `process.env` reads outside the config funnel, and raw `fetch`.

Rather than documenting them and hoping, `scripts/axiom-debt.json` records the
exact per-file counts and `bun run axiom-debt` fails on **any** difference — a
new violation *or* a repaid one. New code therefore cannot add debt silently,
and every repayment lands as a smaller number in a reviewable diff:

```bash
bun run axiom-debt          # gate (CI + pre-push)
bun run axiom-debt:update   # after paying some down; commit the new baseline
```

**A ratchet is meant to end.** There were four classes; `json-cast` was the
fourth, with ~40 sites in `apps/web` that had nothing to decode against. Once
`shared/` existed those were paid off, `no-cast-json.grit` was widened to every
workspace, and the class was **deleted** — a lint rule cannot be paid back down,
so it needs no ratchet. That is the intended end state for each of the three
that remain: drive the count to zero, then replace the class with the rule.

### Evals and retrospectives close the loop

Tests and lint verify deterministic code. **Evals** verify the non-deterministic
half — including the harness itself. `evals/` is a grid of
`task × model × repeat`: each cell hands one task to a headless agent in a
throwaway worktree, then judges it twice. The repo's own gates — every step
`bun run verify` composes, *derived* from package.json rather than listed — prove
nothing broke; per-task **asserts**, mostly real HTTP and WebSocket traffic
through `evals/probe.ts`, prove the feature actually runs.

The asserts are worth **twice** the gates, and that ratio is the whole point:
`bun run verify` is green on an untouched checkout, so the gates-only eval this
replaced scored an agent that changed nothing a perfect 1.0. The shares are per
*jury*, not per check, which pins the do-nothing ceiling at 1/3 however many
gates or asserts a task happens to have. `bun run evals:baseline` runs the entire
grid with **no agent** — free, and the only honest way to ask what a task is
worth before the work is done. `bun run doctor` rejects a task with no asserts,
and the report flags any assert that is already green before the agent starts.

The task set spans application *archetypes*, not just CRUD — pure algorithm,
persistence + state machine, external HTTP failure mapping, a `@pid/shared`
contract, cross-cutting middleware, a web query slice, background (non-request)
work, SSE, WebSocket, rename survival — so a structure that only fits one shape
shows up as a column of zeros. `evals/report.ts --compare` answers *did my
harness change help?* against a 2σ noise floor built from the repeats, never a
single run: score up → keep it and ratchet the floor; a sustained drop → revert.
Weekly in CI (`.github/workflows/evals.yml`); the free baseline always runs, the
paid grid no-ops without an `ANTHROPIC_API_KEY`.

When a change to `CLAUDE.md`, a skill, a hook or a gate makes agents start
failing these tasks, the harness regressed: fix the harness, not the task.

`/retro` (`.claude/skills/retro`) is the diagnosis step. It mines the git
history, merged PRs and the gate output into a few ranked, **enforcement-biased**
proposals — prefer a hook, lint rule, test or script over a written guideline,
because enforcements compound and guidelines decay. Loop: `/retro` proposes →
apply → re-run the evals → keep what raises the score.

### Pick the model tier from the grid, not from habit

Strong determinism is supposed to buy a cheaper model, and the grid is what says
where it actually does: `evals/report.ts` ranks each tier by mean score **and by
cost per point**, so a model that is 10× cheaper but fails half the grid stops
looking cheap. Route per *archetype*, because that is where tiers diverge —
structural work inside a shape the scaffolder already stamps out is a different
task from behaviour that has to be live-correct (background work, upstream
failure mapping, streaming; anything whose proof is a round-trip rather than a
type).

**The numbers for this repo are not measured yet.** Measure them with
`bun run evals -- --suite full --models opus,sonnet,haiku`, record the table and
its σ under "Reference run" in `evals/README.md`, and update this paragraph in
the same commit. Do not import another repo's figures: a score is a property of
*this* harness — its gates, its tasks, its asserts — not of the model alone.
Re-measure after a harness change or a new model release, and before concluding a
tier cannot do something, re-run that cell with `--repeats 3`: a single red cell
is often variance, which is why the noise floor exists at all.

### The harness checks itself

Enforcement attaches to file *shape* (`**/*.core.ts`, `**/*.io.ts`,
`**/features/**`), not to a path: denials are global, allows are sanctioned
shapes, so renaming or adding an app cannot make a rule quietly stop applying.

`bun run doctor` (`scripts/check-harness.ts`, inside `bun run test`) then
asserts the enforcement stack itself: grit plugins referenced and present, the
core-purity override still scoped by shape and still denying every listed
global, the one-param plugin still covering the cores, the cast ban still
covering every workspace, lefthook jobs wired, gate scripts composed into `test`
and `verify`, every workspace inside the typecheck, the two gate scripts still
deriving their scope from `workspaces`, every workflow's actions pinned to commit
SHAs, the canon block in sync — and the literal CI job names the branch ruleset
requires as status checks. Deleting a gate is a deliberate, visible act that
fails CI, not silent drift.

Its own inputs are *discovered*, never listed: workspaces from `package.json`,
workflows from the directory, plugins from a glob. A hand-maintained list inside
the checker would fail open in exactly the way the checker exists to prevent.

**Being offline is the one hole doctor cannot close about itself.** It validates
the *committed* `.github/rulesets/main.json` against the job names the workflows
declare, but it cannot ask GitHub whether that file still describes reality — so
branch protection edited through the web UI leaves the committed contract stale
in silence, every gate stays green, and this checker goes on validating a
contract nobody enforces. `.github/workflows/ruleset-drift.yml` closes it from
the other side, on a cron for the same reason `bun audit` is on one: drift
arrives on someone else's clock, not on our PR traffic. It reconciles live
against committed, opens or refreshes ONE deduped `governance` issue and closes
it when they agree again — never a red run, because a permanently red cron badge
becomes wallpaper, and reconciling is a real decision that may take days
(sometimes the UI edit is the correct one and the *file* is what should change).
It fails only when the comparison itself fails, which must never be readable as
agreement. The comparison is semantic, not textual: the live payload is
projected onto the shape the committed file declares and both sides are
canonically sorted, because a `jq -S`-grade compare would report drift every day
over key ordering alone and be muted inside a week. Reading a ruleset needs no
admin — only *writing* one does, which is why `apply-ruleset.sh` is human-run and
this is not. `bun run doctor` asserts the watch by shape (a cron trigger and the
drift comparison in one workflow), so renaming the file is fine and deleting the
step is not.

**Do not rename the `lint` / `bun-test` job display names in
`.github/workflows/unit-tests.yml`.** The branch ruleset pins its required
status checks to the exact strings `biome ci (lint + format)` and
`bun test (daemon + web)`; renaming one makes every PR unmergeable ("the base
branch policy prohibits the merge") while every visible check is green. Update
the ruleset first. `bun run doctor` guards those two strings.

### Gate commands

```bash
bun install            # installs + wires git hooks (lefthook)
bun run verify         # lint:ci + typecheck + test + web/cli suites + audit + axiom-debt
bun run lint           # biome check --write .   (autofix)
bun run lint:ci        # biome ci .              (CI gate)
bun run typecheck      # tsc --noEmit over every workspace
bun run test           # colocation + doctor + daemon + shared + scripts + evals suites
bun run test:web       # web unit suite
bun run test:cli       # cli unit suite
bun run test:shared    # shared contract suite
bun run test:e2e       # playwright (apps/e2e)
bun run test:mutation  # stryker over *.core.ts (also weekly in CI)
bun run audit          # fallow: dead code / duplication / cycles / complexity
bun run doctor         # harness self-check (also inside `test`)
bun run axiom-debt     # ratchet on the four debt classes
bun run scaffold:slice # generate a feature slice in canonical shape
bun run scaffold:theme # generate a daisyUI theme family, contrast solved
bun run theme:check    # the four theme gates only — the inner loop, ~0.1s
bun run evals          # graded agent grid (needs ANTHROPIC_API_KEY)
bun run evals:baseline # the same grid with NO agent — free, and keeps it honest
bun run evals:report   # score a run, or --compare two against the noise floor
bun run dev            # daemon (:8787) + web (:5173)
```

### How to add a feature slice

1. `bun run scaffold:slice <feature>` — never hand-copy an existing slice. Add
   `--door` when another slice will consume this one; it also emits
   `<feature>.door.ts`, the slice's published surface.
2. Grow the pure decision logic in `<feature>.core.ts` + its co-located test.
   If the rule is data-in/data-out, it belongs in the core, not in a handler.
3. Replace the stub I/O in `<feature>.io.ts`. Keep `<Feature>IoTest` in step
   with the live Layer; the route test runs the real handlers over it.
4. Widen `<Feature>Error` *and* `STATUS_BY_ERROR` together for each new failure
   mode.
5. Promote any type `apps/web` also needs to `shared/src` as a `Schema`, and
   re-export it from `shared/src/index.ts`. Do not hand-copy it.
6. (web) add the query hook and route under `apps/web/src/features/<feature>/`,
   going through the typed RPC client and decoding with the shared helper.
7. `bun run verify`.
<!-- CANON:END -->
