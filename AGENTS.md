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
                        /sessions/:id/explain  (state provenance: source, staleness, why)
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
                        { scope, id, state, matcher, evidence, at }
fleet.run            ← a fleet run or one of its steps changed status; payload =
                        the run summary (see "Fleet recipes" below)
rules.fired          ← a state-change rule matched and either fired or was
                        suppressed; payload = { _tag, rule, short, action,
                        reason?, at } (see "State-change rules" below)
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
- `GET /rules`, `POST /rules/pause`, `POST /rules/preview` — state-change
  automation rules, off by default. Daemon + CLI only — no web UI yet (see
  "State-change rules" below).

### Server-owned waits (`features/sessions/sessions-wait.*`)

`POST /sessions/:id/wait` and the optional `wait` object on `POST
/sessions/:id/send` let a caller block on a session reaching one of a set of
states instead of polling `GET /sessions` — the daemon already publishes
`session.state` / `session.removed` / `terminal.state` on the SSE bus, so the
wait is event-driven, not a poll loop.

- Body: `{ until: SessionStateSlug[], timeoutMs?, via? }` — `until` non-empty,
  `timeoutMs` defaults to 30s, capped at 10 minutes, `via` defaults to
  `"supervisor"`.
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
- `session.removed` settles `Removed` under every `via` — a deleted session is
  not an observation about state, it is the end of the thing observed.
- **How the screen reaches this slice.** The terminal slice publishes one door,
  `readTerminalState({ scope, id })` over its own `terminalStates` map;
  `api.ts` passes it as an injected port into `buildSessionsApp` and into the
  fleet run ports. `sessions-wait.core.ts` only ever sees plain data (a
  `SessionStateSlug | undefined`), and neither the core nor
  `sessions-wait.io.ts` imports the terminal slice. It is a port rather than a
  `Context.Tag` for a concrete reason: `terminal.routes.ts` imports
  `platform/runtime.ts`, so a Layer dependency would close an import cycle
  through the very runtime that provides it.

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
status-line and dialog shapes — Claude Code's `"<Gerund>…(<N>s · …)"` while
generating, `"⎿ Waiting…"` mid-tool-call, `"<PastVerb> for <N>s"` once a turn
ends, `"Do you want to proceed?"` (or its reject option) while blocked on a
permission decision; pi's `"Working..."` spinner — against a per-connection
rolling tail, stripped of ANSI first. States: `working`, `blocked`, `idle`,
`unknown` — `unknown` is the honest default when nothing matches, not a
guessed `idle`.

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

- `GET /terminal/states` — `{ "<scope>:<id>": { scope, id, state, matcher,
  evidence, at } }` for every terminal classified so far, so a client that
  connects late can render a chip immediately. `pid terminals` (see
  "Agent-facing CLI" below) is the same map for an agent, so this classification
  is not browser-only.
- `terminal.state` SSE event — published only on an actual state change (no
  event per keystroke), throttled to at most one classification pass per
  400ms per connection so a fast-redrawing spinner doesn't cost a regex pass
  per chunk.
- Two producers write the same map and the same event. The WS tap above covers
  every terminal a browser is looking at; the **unattended poller** below covers
  the rest.

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
  list-panes` first, keeps only `TYPE=terminal` rows (the daemon's layouts wrap
  every content pane in tab-bar/status-bar *plugin* panes) and dumps the
  lowest-indexed one.
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
  polled session costs TWO subprocess spawns per pass (`list-panes` +
  `dump-screen`), where the attached path costs a regex over bytes it already
  has. Passes are sequential, never fanned out, and one session dying mid-pass
  does not abort the rest.
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
  cannot name (started by hand outside the dashboard's naming scheme); panes
  beyond the first terminal pane in a session; and a session drill-in exposed
  under a `daemonShort` alias, whose polled record is keyed by the canonical
  roster short, so the chip appears under that id rather than the alias.
- Evidence for every VERIFIED row is one of two kinds, named in the row's own
  comment: bytes captured from a real pty run, or a literal read straight out
  of the shipped CLI — `strings -a` on the Claude Code binary
  (`~/.local/share/claude/versions/<version>`, a single compiled Mach-O
  executable) for `"Do you want to proceed?"` and its reject option (found
  adjacent to unambiguous tool-approval identifiers — "Bash command
  (unsandboxed)", "accept-once", "confirm:yes" — confirming it is the
  dialog's own copy), or pi's unminified `dist/` source directly for
  `"Working..."`. No row was fabricated from memory of what a CLI "probably"
  prints. The permission-prompt rows have binary-string evidence but not a
  captured live render — every attempt to trigger the dialog against a real
  `claude` process here auto-approved the tool call first (a broad
  user-level Bash allow-list). See the matcher table's comments for the full
  trail per row, including a documented pi hint (`(escape to interrupt)`)
  that exists in source but was not observed live, so has no matcher of its
  own.

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

## State-change rules (`<claudeConfigDir>/pid-dashboard/rules.json`)

herdr's own docs leave "when a session does X, do Y" to shell scripting over
its CLI — there is no configuration-based trigger, no on-state-change action.
This repo already publishes every transition on the SSE bus and already has
the named-key vocabulary and the wait primitive, so a rules engine is the
layer neither tool covers: a session that goes `blocked` at 3am can page you,
and a session that finishes can kick off the next step.

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
- **Two loop breakers**, both enforced in the pure core (`evaluate`) and
  tested there:
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
- **A dry-run preview** (`POST /rules/preview`) evaluates every
  currently-known session against the rules file on disk and reports what
  would happen — fires nothing, calls no port, records nothing. It ignores
  the file's own top-level `enabled` gate (but not a rule's own `enabled`) so
  an author can test-drive a rules file before ever flipping automation on.
- **A pause switch** (`POST /rules/pause`) at runtime, mirroring
  `issue-driver`'s own `/pause` — suppresses every action without touching
  the file or losing the engine's tracked session state.
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
        "state": "blocked",              // required: blocked | needs_input | done | failed | idle | unknown
        "forMs": 300000,                 // optional: present = dwell condition, absent = transition condition
        "harness": "claude",             // optional: claude | pi — restrict to one CLI's sessions
        "stale": true                    // optional boolean — match sessions-explain.core's own staleness verdict
      },
      "then": {
        "action": "notify",              // notify | keys | stop
        "message": "still blocked after 5 minutes"
      },
      "cooldownMs": 300000               // optional, default 300000, integer 0..86400000
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

### Actions (`do`)

- **`notify`** — `{ action: "notify", message }`. Publishes a `notification`
  SSE event (`{ short, rule, message, at }`) for a future web toast/notifier,
  distinct from the `rules.fired` audit event every outcome already gets
  (see "SSE surface" below).
- **`keys`** — `{ action: "keys", sequence: NamedKey[], confirm: true }`. The
  same 15-name vocabulary "Named key vocabulary" above documents (no `text`
  steps, no `repeat` — just names); resolved through the REAL
  `sessions-keys.core.ts` vocabulary at the wire boundary, not the rules
  slice's own mirrored copy, so a vocabulary drift would surface as a runtime
  error rather than silently sending the wrong bytes. **`confirm: true` is
  mandatory to ever actually fire** — see "Safety" above.
- **`stop`** — `{ action: "stop" }`. Ends the session the supported way
  (`ShellIo.stop`, the same call `POST /sessions/:id/stop` makes).

### Validation

`parseRulesFile` collects **every** error in one pass, the same discipline
`parseFleetFile` uses: a bad `name`, an unrecognized `when.state` /
`when.harness`, an out-of-range `when.forMs` / `cooldownMs`, a malformed
`then`/`do` object for the declared `action`, an unknown key name in a `keys`
sequence, and duplicate rule names are all reported together, not
one-fix-rerun-see-the-next. A malformed `rules.json` (bad JSON, or JSON that
doesn't match the schema) is never a 500: `GET /rules` and `pid rules` both
surface it as an `errors` list — `pid rules` exits 2, the same code `pid
fleets` uses for an invalid recipe. An absent `rules.json` is not an error
either: `{ enabled: false, rules: [] }`, disabled.

### Why the rules slice can't import the real vocabulary

`features/rules/rules.core.ts` mirrors `KNOWN_STATES`, `NAMED_KEYS`, the
`harness` field and `STALE_ACTIVE_MS` as literal copies rather than
importing `sessions.core.ts` / `sessions-keys.core.ts` /
`sessions-explain.core.ts` directly — those are slice internals, not a
published door, and `bun run axiom-debt`'s cross-slice-import counter fails
the build on any NEW violation of that rule. `fleet.core.ts` and
`apps/cli/src/agent/agent.core.ts` hit the identical constraint and keep the
same kind of literal copy; `scripts/mirrored-constants.test.ts` guards all
three against drifting from the real values. For the same reason, the
engine's own picture of "what is every session doing right now"
(`features/rules/rules.io.ts`) is built entirely from decoding
`session.state` / `session.removed` payloads off the SSE bus — it never
queries the sessions slice directly. Ports (`notify`, `sendKeys`, `stop`,
`now`) are injected plain-Promise functions, exactly like
`fleet-run.io.ts`'s `FleetRunPorts`; `api.ts` (outside any slice, so free of
the ratchet) wires the real `ShellIo` / `sse-bus` implementations into them.

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
pid wait <short> --until <slug,...> [--timeout <ms>] [--json]
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
  action; `pid wait` is the same wait as its own subcommand, `--until`
  required. `--timeout` is milliseconds; omitted, the daemon's own default
  (30s, capped at 10 minutes) applies.
- `pid spawn --n <count>` issues `count` independent `POST /dispatch` calls
  with the same intent/agent/cwd, each producing its own short; with `--wait`,
  each spawned short is waited on independently and every attempt's outcome
  (dispatch failure or wait outcome) is printed.
- session states: `done`, `working`, `blocked`, `needs_input`, `idle`,
  `failed`, `stopped`, `unknown`. Key names: `escape`, `enter`, `tab`,
  `shift-tab`, `up`, `down`, `left`, `right`, `home`, `end`, `page-up`,
  `page-down`, `backspace`, `delete`, `space` (the same deliberately-closed
  vocabulary as `POST /:id/keys`, so `ctrl-z`/`ctrl-c` are rejected here too).
- `pid terminals` reads `GET /terminal/states` — the screen classification
  ("Terminal agent-state detection" above) for every terminal the daemon has
  looked at, whether over an attached WS bridge or the unattended poller. It
  answers a different question from `pid sessions`/`pid explain`: those report
  the *roster's* state for work the daemon spawned, while this reports what the
  *pane* shows, which is the only way an agent can see a `claude` or `pi` a
  human started by hand. States are the four screen slugs (`working`,
  `blocked`, `idle`, `unknown`), never the 8 session slugs.
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
  time. A non-empty `errors` list exits 2, the same linter contract as `pid
  fleets`. `pid rules preview` evaluates every currently-known session
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
| 2 | usage error (unknown command, missing argument, bad slug, unknown key name) — or an invalid recipe file / a cap-exceeded `pid fleet run` request |
| 3 | wait timed out |
| 4 | `occupant_changed` — the session was replaced under the wait |
| 5 | `removed` — the session went away |
| 6 | not found — the daemon returned 404, or `pid terminals <scope>:<id>` found no entry for that key |
| 7 | `pid fleet run --wait`: the run finished with a failed or skipped step, or the daemon refused to start it because that fleet already has an active run |

`pid spawn --n <count> --wait` runs `count` independent spawn+wait attempts
and reports the **worst** outcome across all of them as the process exit
code. Worst is ranked by how much the outcome degrades the caller's picture
of what happened, most severe last: `0` (ok) < `3` (timeout — it's out there,
just slow) < `4` (occupant changed) < `5` (removed) < `6` (not found) < `7`
(a fleet run's own rolled-up "did not run cleanly" verdict — see "Executing a
run" above) < `1` (transport/unexpected failure — the caller does not know
what happened at all) < `2` (usage error, which in practice never mixes with
the others since it always short-circuits before any request is made). `pid
fleet run` itself never calls `worstExitCode` (each run only has one
outcome), but 7 sits at this point in the ranking so the severity table
stays total.

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
- [apps/web/src/features/canvas](apps/web/src/features/canvas/CLAUDE.md) — Shared React Flow canvas: sync field-dropping trap, edge-label editing, fitView/bezier e2e geometry.
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
  platform/                  # cross-cutting infra (runtime, config, ws, sse-bus)
  api.ts                     # assembles routes; exports AppType for hc RPC
  server.ts / main.ts        # composition root (Bun.serve, live Layers)
apps/web/                    # Vite + React + TanStack Router (UI only) + Query
apps/cli/                    # `pid-dashboard` single-binary distribution
apps/e2e/                    # Playwright end-to-end suite
scripts/                     # the harness: gate scripts + their co-located tests
```

`platform/` is for infra shared across slices. Anything feature-specific lives
in its slice.

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
`Effect`/`Layer`/`Context` and any `*.io` module are banned, the globals
`Date` / `process` / `Promise` / `console` / `setTimeout` / `setInterval` /
`fetch` are banned, and two GritQL plugins (`biome-plugins/`) ban `throw` and
`await`.

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
- **Everything type-checks.** `scripts/typecheck.ts` discovers every `apps/*`
  workspace from the filesystem and runs `tsc --noEmit` on each; a workspace
  *without* a `tsconfig.json` is an error, not a skip. A hand-maintained project
  list would fail open — this cannot.
- **No raw `fetch`, no `axios`.** `noRestrictedImports` bans `axios`
  repo-wide; the web app talks to the daemon through the typed Hono RPC client
  (`api = hc<AppType>` in `apps/web/src/lib/api.ts`). `*.io.ts` is the sanctioned
  place for a raw request.
- **Contracts decode at the boundary.** `biome-plugins/no-cast-json.grit` bans
  `(await res.json()) as T` — a cast asserts a wire shape without checking it, so
  drift compiles forever and fails at runtime. Hand the decoded `unknown` to a
  pure parser instead.
- **Typed config at boot.** `platform/config.io.ts` (plus `config-dir.ts` and the
  composition roots) is the one place that reads `process.env`. Slices receive
  values; they do not fetch them.
- **Log through the runtime, not `console`.** `noConsole` is an error outside the
  composition root and tests.
- **One parameter on declarations you design.**
  `biome-plugins/max-one-param-declarations.grit` bans 2+ positional parameters
  on named declarations — pass a single options object so the signature stays
  narrow as the implementation deepens. Callback shapes a library dictates
  (`sort((a, b))`, Hono's `(c, next)`) are exempt by construction.
  `complexity/useMaxParams: max 2` is the floor everywhere.
- **Modules talk through doors, not back-channels (modular monolith).** A slice
  may import another slice's *published* door — a service `Context.Tag` — but
  never its internal files. Compose every module's live `Layer` into one process
  by default; a module becomes a separate deployment only under real pressure,
  and because consumers depend on the `Tag`, that split swaps a `Layer` at the
  composition root, not call sites. Design as if distributed; deploy as if
  together.
- **Conventional commits.** `type(scope)?: subject` — the lefthook `commit-msg`
  hook (`scripts/check-commit-msg.ts`) rejects anything else.
- **Dead code, cycles and duplication are audited.** `fallow audit`
  (`bun run audit`) runs in CI and pre-push.
- **Mutation tests grade the assertions.** `bun run test:mutation` mutates every
  `*.core.ts`; line coverage says a line ran, a surviving mutant says nothing
  asserted its behaviour. Weekly in CI, not per-PR — it costs minutes.

### Axiom debt is ratcheted, never waived

Four axioms are violated in bulk by code that predates their enforcement, so
turning them into hard lint errors today would fail CI on ~120 sites:
cross-slice internal imports, `process.env` reads outside the config funnel, raw
`fetch`, and cast `.json()` in `apps/web`.

Rather than documenting them and hoping, `scripts/axiom-debt.json` records the
exact per-file counts and `bun run axiom-debt` fails on **any** difference — a
new violation *or* a repaid one. New code therefore cannot add debt silently,
and every repayment lands as a smaller number in a reviewable diff:

```bash
bun run axiom-debt          # gate (CI + pre-push)
bun run axiom-debt:update   # after paying some down; commit the new baseline
```

### The harness checks itself

Enforcement attaches to file *shape* (`**/*.core.ts`, `**/*.io.ts`,
`**/features/**`), not to a path: denials are global, allows are sanctioned
shapes, so renaming or adding an app cannot make a rule quietly stop applying.

`bun run doctor` (`scripts/check-harness.ts`, inside `bun run test`) then
asserts the enforcement stack itself: grit plugins referenced and present, the
core-purity override still scoped by shape and still denying every listed
global, lefthook jobs wired, gate scripts composed into `test` and `verify`,
GitHub Actions pinned to commit SHAs, the canon block in sync — and the literal
CI job names the branch ruleset requires as status checks. Deleting a gate is a
deliberate, visible act that fails CI, not silent drift.

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
bun run test           # colocation check + doctor + daemon + scripts suites
bun run test:web       # web unit suite
bun run test:cli       # cli unit suite
bun run test:e2e       # playwright (apps/e2e)
bun run test:mutation  # stryker over *.core.ts (also weekly in CI)
bun run audit          # fallow: dead code / duplication / cycles / complexity
bun run doctor         # harness self-check (also inside `test`)
bun run axiom-debt     # ratchet on the four debt classes
bun run dev            # daemon (:8787) + web (:5173)
```

### How to add a feature slice

1. `apps/daemon/src/features/<feature>/<feature>.core.ts` — the pure decision
   logic, plus its co-located `<feature>.core.test.ts`. Start here: if the rule
   can be expressed as data-in/data-out, it belongs in the core.
2. `<feature>.io.ts` — a `Context.Tag` service for every effectful dependency,
   with a `…IoLive` layer and a `…IoTest` layer for tests.
3. `<feature>.routes.ts` — the Hono shell: read through the service, call the
   core, map the result onto a response.
4. Register the live layer in `platform/runtime.ts` and mount the route in
   `api.ts`.
5. (web) add the query hook and route under `apps/web/src/features/<feature>/`,
   going through the typed RPC client.
6. `bun run verify`.

<!-- CANON:END -->
