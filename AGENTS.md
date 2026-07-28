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
│   ├── desktop/       # Electrobun shell, daemon in-process
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

- Package names: `@pid/daemon`, `@pid/web`, `@pid/cli`, `@pid/desktop`, `@pid/e2e`.
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
             ──GET───>  /sessions, /sessions/:id, /sessions/:id/transcript
             ──SSE───<  /events  (live deltas, single stream)
```

SSE event union (exported from daemon, consumed in web):

```
roster.changed       ← roster.json changed; payload = full new id list
session.state        ← state.json changed; payload = parsed state
session.created      ← id appeared in roster (derived from roster.changed)
session.removed      ← id left roster   (derived from roster.changed)
```

- One SSE stream, server fans roster + per-session deltas.
- Heartbeat every 15s; client reconnects with `Last-Event-ID`.
- TanStack Query owns server state. SSE patches `queryClient.setQueryData`.
- POST handlers return the updated entity; SSE remains the truth.

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

## Single-package CLI distribution (`pid-dashboard`)

`apps/cli` publishes the whole dashboard as one dependency-free package:
`bunx pid-dashboard` boots the daemon and the SPA on one port and opens the
browser — no separate `apps/web`/`apps/daemon` setup.

- `apps/daemon/src/api.ts`'s `buildApp(staticDir?)` composes the final request
  handler. With no `staticDir` (dev daemon, Electrobun desktop, e2e) it's
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

### 5. Permission UX — v1 is read-only

`state.json` for a `Needs input` session contains the pending question or permission request. Card renders inline:
- tool name + input snippet (collapse-by-default for long Bash / Edit payloads)
- for `AskUserQuestion`: `questions[].options` rendered as radio/checkbox (read-only — selection is informational only at v1)

Available actions on a `Needs input` card:
- **Open in terminal** — copies `claude attach <id>` to clipboard.
- **Stop** — `POST /sessions/:id/stop` → `claude stop <id>`.
- **Delete** — `POST /sessions/:id/rm` → `claude rm <id>`.

No programmatic approve/deny at v1 — the supervisor exposes no documented IPC for external reply. **This is the project's main known limitation at v1.**

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
- [apps/web/src/features/excalidraw](apps/web/src/features/excalidraw/CLAUDE.md) — Brainstorm V2 Excalidraw boards: 0.18 ESM integration, restoreElements boundary, element-key sync dedupe, canvas-text-not-in-DOM e2e.
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
apps/desktop/                # Electrobun shell embedding the daemon in-process
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
