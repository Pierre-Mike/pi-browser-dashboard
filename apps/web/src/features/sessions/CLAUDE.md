# sessions

Session list + per-session controls. Reads `/sessions` via `useSessions()` (cache patched live by `lib/sse.ts`); writes via `hc` client.

- `ProjectGrid.tsx` — landing page layout. Groups sessions by `s.cwd === project.path`; orphans (cwd doesn't match any project) collapse under an "Other" footer.
- `ProjectSection.tsx` — one project bar + nested card grid. Aggregate dot shows the worst state in the group (`failed > needs_input > working > done > idle`).
- `Sidebar.tsx` — sticky left nav, same grouping logic; highlights the active session by `params.id`; per-project `+` opens `SpawnModal` inline.
- `SessionCard.tsx` — single-session tile. Open-↗ copies `claude attach <short>` to clipboard. `Peek` runs `POST /sessions/:id/peek` (Haiku, costs one quota call). `Send ▾` reveals `SendKeysPanel`. `Kill` → `POST stop`; `Delete` requires a 3 s confirm window then `POST rm`. Whole card is clickable → drill-in.
- `SendKeysPanel.tsx` — preset key buttons (`y\r`, `n\r`, `1\r`…) + free-form input. POSTs `{ keys }` to `/sessions/:id/send` which routes through the daemon's pty attach pool.
- `ChatComposer.tsx` — drill-in composer. Enter to send, Shift+Enter newline, auto-appends `\r`. Optimistic clear so typing stays fluid through the pty round-trip; hard timeout 20 s.
- `TerminalTab.tsx` — full xterm.js terminal connected to `WS /terminal/:short`. `FitAddon` + multi-frame refit (RAF + 60 ms + 250 ms) so the terminal converges on real dims through React's flex-layout settle; `ResizeObserver` handles subsequent resizes. Reconnect button respawns the underlying `claude attach`.
- `useSessions.ts` — `useQuery<SessionState[]>(["sessions"])`. Cache is the source of truth; the SSE patcher writes to it directly.
