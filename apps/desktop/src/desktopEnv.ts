import type { StartDaemonOptions } from "@pid/daemon/server"

// Pure configuration for the embedded daemon + webview. No side effects so it is
// unit-testable; the imperative shell (main.ts) consumes these values.

// Origin the Electrobun native webview presents when it loads the SPA via the
// `views://` protocol. The daemon must allow it through CORS (the SPA talks
// straight to localhost:8787, not through Vite's dev-only `/__api` proxy).
export const WEBVIEW_ORIGIN = "views://mainview"

// Fixed local port the embedded daemon binds and the SPA is built to target
// (VITE_API_URL=http://localhost:8787). Kept identical to the dev daemon.
export const DAEMON_PORT = 8787

// Entry the BrowserWindow loads — the production SPA build copied into the
// bundle under views/mainview.
export const webviewUrl = (): string => `${WEBVIEW_ORIGIN}/index.html`

// Options for startDaemon() when embedded in the desktop app: no public tunnel,
// fixed port, and CORS opened for the webview origin.
export const daemonLaunchEnv = (): StartDaemonOptions => ({
  port: DAEMON_PORT,
  tunnel: false,
  corsOrigins: [WEBVIEW_ORIGIN],
  allowViewsOrigin: true,
})
