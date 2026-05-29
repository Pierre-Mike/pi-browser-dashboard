# pi-browser-dashboard

A browser front-end to Claude Code's `claude agents` background sessions. Same
supervisor, same worktrees, same auto-cleanup — different surface: a grid of
cards reachable from any device, with richer permission and artifact
rendering than a terminal can manage.

> Status: pre-1.0. APIs, file layouts, and UI all move. Pin a commit if you
> depend on a specific behavior.

## What it does

- **Grid of session cards** — one per `claude --bg` background session,
  refreshed live via SSE from the supervisor's `roster.json` / `state.json`.
- **Dispatch bar** — type a prompt, pick agent + permission mode, spawn N
  parallel sessions in one click. Filter syntax mirrors `claude agents`
  (`a:<agent>`, `s:<state>`, `#<pr>`).
- **Drill-in transcript** — JSONL transcript renderer with tool-use,
  tool-result, and assistant blocks.
- **Browser terminal** — embedded xterm.js attached to a per-session
  `zellij` layout so you can fall back to the CLI without losing context.
- **Project view** — files, README/markdown/image/PDF previews, PR status,
  Claude config (hooks, skills, settings) browser.
- **Stateless daemon** — no database. The supervisor owns processes,
  worktrees, and persistence; the daemon is a thin watcher + shell-out.

## Requirements

- [Bun](https://bun.sh) ≥ 1.1
- [Claude Code](https://claude.com/claude-code) CLI on `PATH`, interactively
  signed in at least once. The dashboard never talks to the Anthropic API
  directly — it shells out to `claude --bg`, `claude stop`, `claude rm`, etc.
- macOS or Linux. Windows is untested.
- `zellij` for the embedded terminal (optional).

## Quick start

```bash
git clone https://github.com/Pierre-Mike/pi-browser-dashboard.git
cd pi-browser-dashboard
bun install
bun run dev
```

This starts:

- daemon on `http://localhost:8787`
- web app on `http://localhost:5173`

Open the web app. The grid will populate once you spawn a session, either
from the dispatch bar or via `claude --bg "<prompt>"` in any directory.

### Environment

| Variable             | Default                  | Purpose                                 |
| -------------------- | ------------------------ | --------------------------------------- |
| `PID_DAEMON_URL`     | `http://localhost:8787`  | Web → daemon URL (used by the dev proxy) |
| `PID_WEB_PORT`       | `5173`                   | Vite dev server port                    |
| `CLAUDE_CONFIG_DIR`  | `~/.claude`              | Claude Code config root the daemon watches |

## Repo layout

```
apps/
  daemon/   # Bun + Hono + Effect-TS service. Stateless.
  web/      # Vite + React + TanStack Router SPA.
  e2e/      # Playwright suite.
scripts/    # TDD floor + feature-test gate.
.claude/loops/  # host-level launchd scripts (issue-driver pipeline)
.githooks/  # pre-commit + pre-push (test-touched + e2e).
.github/    # CI workflows + issue/PR templates.
AGENTS.md   # Architecture, surface area, deferred work.
```

Package names: `@pid/daemon`, `@pid/web`, `@pid/e2e`. The daemon exports its
Hono `AppType` via `@pid/daemon/types`; the web app consumes it with
`hc<AppType>` for end-to-end typed RPC.

## Tests

```bash
bun run test          # daemon unit tests (bun test)
bun run test:e2e      # Playwright e2e
bun run lint          # Biome check + fix
bun run lint:ci       # Biome check (no fix)
```

Pre-commit blocks any commit that touches `apps/*/src/**` without staging a
test. Pre-push runs the unit + Playwright suite. Bypasses (`SKIP_TDD=1`,
`SKIP_E2E=1`) exist for docs/dep-only commits — see `AGENTS.md`.

## Authoring an extension

Scaffold a new iframe extension with the `pid-ext` generator:

```bash
bun run pid-ext my-ext           # local scope → <cwd>/.pid/extensions/my-ext
bun run pid-ext my-ext --global  # global scope → ~/.pid/extensions/my-ext
```

This writes two files:

| File | Purpose |
| --- | --- |
| `manifest.json` | Extension metadata (name, version, tier, tabs) |
| `index.html` | Self-contained iframe page; posts `getContext` RPC to the dashboard |

After running the generator, restart the daemon (`bun run dev:daemon`) and open
the **Extensions** tab in the dashboard — your extension's tab will appear.

To use `listFiles` / `readFile` RPC methods, grant the **fs** capability to
your extension in the Extensions tab.

A working example lives at [`examples/extensions/hello/`](./examples/extensions/hello/).

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for workflow, code style, and
testing expectations. For architecture and roadmap, read `AGENTS.md`. For
vulnerabilities, see [SECURITY.md](./SECURITY.md).

## License

MIT — see [LICENSE](./LICENSE).
