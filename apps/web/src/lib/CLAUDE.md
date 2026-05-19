# lib

Cross-feature utilities. Anything shared by ≥2 features lives here; feature-local helpers stay inside the feature.

- `api.ts` — `hc<AppType>(VITE_API_URL ?? "http://localhost:8787")` typed Hono client. `AppType` is imported from `@pid/daemon/types`; if isolated typecheck can't resolve it, call-sites cast the client to `any` (suppressed with biome-ignore) and rely on network-surface types only.
- `sse.ts` — `startSse(queryClient)` opens `/events`, parses each event, and patches the TanStack Query cache directly: `session.state` upserts into `["sessions"]` and `["sessions", short]`; `roster.changed | session.created | session.removed` invalidate `["sessions"]`. Watchdog reconnects after 25 s of silence (heartbeat is 15 s + slack) — covers Vite-proxy daemon restarts where the downstream socket stays open but no events arrive. Window-global `__PID_SSE_DEBUG__` enables console logging.
- `types.ts` — local mirror of daemon `SessionState`, plus `Project`, `FileEntry`, `FileListing`, `FileContent`, `TranscriptMessage`. Duplicated (not imported from `@pid/daemon`) so components stay typeable before `bun install`.
- `format.ts` — `ageStr` (relative s/m/h/d), `cwdTail(cwd, n=2)` (last n path segments), `stateColor` (`SessionStateValue → { bg, text, dot, ring, label }` Tailwind palette), `STATE_ORDER`.
- `query-client.ts` — singleton `QueryClient` mounted in `main.tsx`.
