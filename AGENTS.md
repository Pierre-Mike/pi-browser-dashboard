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
│   └── web/           # Vite + React SPA
├── biome.json
├── lefthook.yml
├── tsconfig.base.json
├── package.json       # bun workspaces, no Turborepo
├── AGENTS.md
└── .gitignore
```

- Package names: `@pid/daemon`, `@pid/web`.
- Daemon exports `AppType` via `"exports": { "./types" }`; web imports it for `hc<AppType>` client.
- `tsconfig.base.json` extended by both apps; `strict: true`, `noUncheckedIndexedAccess: true`.
- `AGENTS.md` at root, `CLAUDE.md` per app.
- No `dist/`, no `node_modules` in git.

## Stack lock-ins

| Layer       | Choice                                                                                                                                                |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repo        | bun workspaces, no Turborepo                                                                                                                          |
| Tooling     | Biome (`biome ci` in CI), Lefthook (`stage_fixed: true`)                                                                                              |
| Daemon      | Bun + Hono + Effect-TS, FCIS suffix-discipline (`*.core.ts` / `*.repo.ts` / `*.routes.ts`), `hc<AppType>` typed RPC                                   |
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
│   ├── shell.repo.ts          # spawn/wait/collect shell commands (Effect-wrapped)
│   ├── fswatch.repo.ts        # Bun.watch wrapper, debounced
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
- `*.repo.ts` = Effect services behind `Context.Tag`. `shell.repo` and `fswatch.repo` encapsulate all side effects.
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

## Engineering axioms (inherited)

- **Effect-TS** for error handling, DI, concurrency — no `try/catch`, no mock frameworks.
- **Functional Core / Imperative Shell** — pure `*.core.ts`, services in `*.repo.ts`, orchestration in `*.routes.ts`.
- **Biome** for lint+format. No ESLint/Prettier.
- **Bun** for dev/build/runtime.
- **Named parameters** (destructured objects) for 3+ params (Biome `complexity/useMaxParams: { max: 2 }`).
- **Immutability by default** — `readonly`, `as const`.
- **Co-located tests** — `foo.ts` → `foo.test.ts` next to it.
- **No `any`**, **no `console.log`**, **no empty catch**, **no `as` casts outside tests** — decode via `@effect/schema`.
- **Pin versions** — pin Claude Code version range; pin model versions in any SDK call.
