// Pure CORS origin resolution. Evaluated per-request so the allow-list reflects
// the current environment — PID_CORS_ORIGINS can be injected after this module is
// already imported (the e2e harness points the daemon at its own web port).
//
// The browser deployment serves the SPA same-origin behind Vite's `/__api`
// proxy, so only the dev origin needs allowing by default. Anything else — a
// tunnel hostname, an alternate web port — is opted into explicitly through
// PID_CORS_ORIGINS. There is no scheme wildcard: an origin is allowed because it
// was named, never because it looked close enough.

const DEFAULT_ORIGINS = ["http://localhost:5173"]

export type CorsEnv = {
  PID_CORS_ORIGINS?: string
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
export const resolveCorsOrigin = (requestOrigin: string, env: CorsEnv): string | null =>
  allowedOriginList(env).includes(requestOrigin) ? requestOrigin : null
