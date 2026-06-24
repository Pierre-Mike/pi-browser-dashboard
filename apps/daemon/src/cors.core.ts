// Pure CORS origin resolution. Evaluated per-request so the allow-list reflects
// the current environment (the embedded-daemon path injects PID_CORS_ORIGINS /
// PID_ALLOW_VIEWS_ORIGIN before serving, after this module is already imported).
//
// The browser deployment serves the SPA same-origin behind Vite's `/__api`
// proxy, so only the dev origin needs allowing. The Electrobun desktop app loads
// the SPA from a `views://` webview origin and talks straight to the daemon, so
// that origin must be allowed too — gated by PID_ALLOW_VIEWS_ORIGIN so the
// public/browser daemon never opens up to an arbitrary custom scheme.

const DEFAULT_ORIGINS = ["http://localhost:5173"]

export type CorsEnv = {
  PID_CORS_ORIGINS?: string
  PID_ALLOW_VIEWS_ORIGIN?: string
}

const parseList = (raw: string | undefined): string[] =>
  (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)

export const allowedOriginList = (env: CorsEnv): string[] => [
  ...DEFAULT_ORIGINS,
  ...parseList(env.PID_CORS_ORIGINS),
]

// Returns the origin to echo back in `Access-Control-Allow-Origin`, or null to
// deny. Mirrors hono/cors' `origin` callback contract.
export const resolveCorsOrigin = (requestOrigin: string, env: CorsEnv): string | null => {
  if (allowedOriginList(env).includes(requestOrigin)) return requestOrigin
  if (env.PID_ALLOW_VIEWS_ORIGIN === "1" && requestOrigin.startsWith("views://")) {
    return requestOrigin
  }
  return null
}
