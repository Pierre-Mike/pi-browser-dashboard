# @pid/desktop

The dashboard packaged as a cross-platform [Electrobun](https://blackboard.sh/electrobun/) desktop app.

## How it works

- `src/main.ts` is the Electrobun **main process** (Bun). It boots the daemon
  in-process via `startDaemon()` (from `@pid/daemon/server`) with the public
  Cloudflare tunnel **off** and CORS opened for the webview origin, then opens a
  `BrowserWindow` that loads the production SPA build through the `views://`
  protocol.
- The SPA (`apps/web`) is built with `VITE_API_URL=http://localhost:8787` so
  `apiBase()`/`wsBase()` talk straight to the embedded daemon — the dev-only
  Vite `/__api` proxy does not exist in a packaged app.
- `src/desktopEnv.ts` holds the pure, unit-tested config (port, webview origin,
  daemon launch options).

## Build locally

```bash
# From the repo root — builds the SPA for the embedded daemon, then bundles.
bun run build:desktop
```

Artifacts land in `apps/desktop/artifacts/` (macOS `.dmg`/`.app`, Windows `.zip`
installer, Linux `.tar.gz`).

## Download

CI (`.github/workflows/desktop-release.yml`) builds on macOS, Windows, and Linux
on every `v*` tag and attaches the installers to the matching GitHub Release.

## Notes

- `bundleCEF: false` → uses the OS-native webview (WKWebView / WebView2 /
  WebKitGTK) for the small ~14MB bundle.
- v1 ships **unsigned**: on macOS right-click → Open the first time; on Windows
  dismiss the SmartScreen prompt. Code-signing/notarization is future work.
