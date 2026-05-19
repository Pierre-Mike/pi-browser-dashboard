# platform

Cross-feature infrastructure. No feature imports another feature directly — they compose through these primitives or via the SSE bus.

- `runtime.ts` — composes the `appRuntime` (`ManagedRuntime`) from `SessionRegistryLive`, `ShellRepoLive`, and `ProjectsRepoLive ← ConfigRepoLive`. Lives for the process lifetime so the session-registry watchers stay attached. `shutdownRuntime()` disposes on exit.
- `shell.repo.ts` — Effect service wrapping every `claude` shell-out: `dispatch` (parses `backgrounded · <short>` from stdout), `stop`, `rm`, `peek`. `send` uses a persistent attach pool (`Bun.spawn("claude", "attach", id)` per session) so only the first keystroke pays the ~1.5 s boot cost; concurrent sends to one id are serialized through a promise chain, idle attaches evicted after 5 min via `Ctrl+Z` + kill. ANSI stripped before short-id regex.
- `fswatch.repo.ts` — `watchFile(path, onChange)` polls `fs.statSync` every 500 ms on `(exists, mtimeMs, size, ino)`. Polling on purpose: macOS `fs.watch` orphans the inode when the supervisor rewrites `roster.json` via tmp + rename. Interval is `unref`'d.
- `sse-bus.ts` — single in-process pub/sub. `subscribe(cb)` returns an unsubscribe; `publish({ type, data })` fans out, swallowing subscriber throws.
- `config.repo.ts` — `ConfigService` exposing `projectsRoot` (`PID_PROJECTS_ROOT` ?? `~/Github`), `claudeConfigDir` (`CLAUDE_CONFIG_DIR` ?? `~/.claude`), `appPort` (`PORT` ?? 8787).
- `config-dir.ts` — `@deprecated` standalone `resolveConfigDir()` for the few call-sites that haven't migrated to `ConfigService` yet.
