import type { ServerWebSocket } from "bun"
import { createBunWebSocket } from "hono/bun"

// Single Hono+Bun WS instance shared across feature routes. `createBunWebSocket`
// returns one `websocket` handler that Bun.serve consumes; every
// `upgradeWebSocket(...)` from the *same* call attaches itself to that handler.
// Two instances would race over the same Bun.serve slot, so all WS-bearing
// features must import from here.
export const { upgradeWebSocket, websocket } = createBunWebSocket<ServerWebSocket>()
