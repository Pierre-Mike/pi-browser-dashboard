# events

`GET /events` — single SSE stream multiplexing all server-side deltas. Subscribes to `sseBus`, forwards each `{ type, data }` event with an incrementing `id` so clients can resume via `Last-Event-ID`. Emits an immediate `heartbeat` so proxies (Vite's http-proxy-middleware) flush headers without waiting 15s for the first real beat; subsequent heartbeats every 15s. Event types produced elsewhere and fanned out here: `roster.changed`, `session.created`, `session.state`, `session.removed`. One stream per browser; web reconnects on silence (see `apps/web/src/lib/sse.ts` watchdog).
