// Single source of truth for the daemon API base URL.
//
// The Cloudflare quick-tunnel points at the Vite dev server, so the public URL
// serves the SPA — the daemon (:8787) is never publicly reachable on its own.
// Hard-coding `http://localhost:8787` worked only because the dev origin and
// the daemon shared a machine; over the tunnel it resolves to the *viewer's*
// localhost and fails the browser's access-control / mixed-content checks.
//
// Fix: in the browser, talk to the same origin under the `/__api` prefix, which
// Vite (dev) and the tunnel proxy strip and forward to the daemon. That keeps
// every request same-origin — no CORS, no mixed content — whether the page is
// loaded from localhost:5173 or a `*.trycloudflare.com` URL.
//
// `VITE_API_URL` still wins when set (e2e points it straight at the daemon, no
// prefix), and the no-window path falls back to the local daemon.
export const API_PREFIX = "/__api"

// Pure core: given the explicit override and the current origin (null when not
// in a browser), return the base the client should use for daemon calls.
export const computeApiBase = (envUrl: string | undefined, origin: string | null): string => {
  if (envUrl) return envUrl
  if (origin) return `${origin}${API_PREFIX}`
  return "http://localhost:8787"
}

// Imperative shell: read the impure sources and delegate to the pure core.
export const apiBase = (): string =>
  computeApiBase(
    import.meta.env.VITE_API_URL as string | undefined,
    typeof window !== "undefined" ? window.location.origin : null,
  )

// WebSocket base — same-origin `/__api`, identical to the HTTP base above.
// terminal/canvas sockets route through Vite's `/__api` proxy (which has
// `ws: true`), so they ride the same tunnel origin as every other request.
// This works because the dev/preview server runs Vite under Node, not Bun:
// http-proxy relays the upstream `101 Switching Protocols` via Node's
// `httpServer.on("upgrade")` event, which Bun's node:http layer does not drive
// (see devRuntime.test.ts). The tunnel only exposes the Vite origin — never the
// daemon's :8787 — so a same-origin WS is the only one that reaches it.
//
// `VITE_API_URL` still wins (e2e points it straight at the daemon, no prefix),
// and the no-window path falls back to the local daemon.
export const computeWsBase = (envUrl: string | undefined, origin: string | null): string =>
  computeApiBase(envUrl, origin)

export const wsBase = (): string =>
  computeWsBase(
    import.meta.env.VITE_API_URL as string | undefined,
    typeof window !== "undefined" ? window.location.origin : null,
  )
