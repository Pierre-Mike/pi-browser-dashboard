# @pid/daemon

Bun + Hono + Effect-TS service on port 8787. Thin file-watcher over the Claude Code supervisor: watches `~/.claude/daemon/roster.json` and per-session `~/.claude/jobs/<short>/state.json`, exposes typed REST endpoints (`/sessions`, `/dispatch`) and a single SSE stream at `/events`. Stateless — supervisor owns processes, worktrees, and persistence. Spawns sessions via `claude --bg` (`shell.repo`); stop/rm via `claude stop|rm`. Pure parsers live in `*.core.ts`, side-effects in `*.repo.ts`, HTTP boundary in `*.routes.ts`.
