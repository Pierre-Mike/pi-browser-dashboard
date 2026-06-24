import type { ElectrobunConfig } from "electrobun"

// Electrobun build/packaging config. The Bun entrypoint is our main process
// (boots the embedded daemon + opens the window). The SPA is built separately
// by Vite (`bun run build:desktop`) into apps/web/dist and copied into the
// bundle under views/mainview, loaded via `views://mainview/index.html`.
//
// bundleCEF:false → use the OS-native webview (WKWebView / WebView2 / WebKitGTK)
// for the ~14MB tiny bundle. Cross-platform/arch output is produced by running
// `electrobun build` on each OS runner in desktop-release.yml, not via config.
export default {
  app: {
    name: "pi-dashboard",
    identifier: "sh.pi.dashboard",
    version: "0.1.0",
  },
  runtime: {
    exitOnLastWindowClosed: true,
  },
  build: {
    bun: {
      entrypoint: "src/main.ts",
      sourcemap: "linked",
      minify: true,
    },
    // Copy the prebuilt Vite SPA (apps/web/dist) into the bundle's view dir.
    copy: {
      "../web/dist/index.html": "views/mainview/index.html",
      "../web/dist/assets": "views/mainview/assets",
    },
    watchIgnore: ["../web/dist/**"],
    mac: { bundleCEF: false },
    linux: { bundleCEF: false },
    win: { bundleCEF: false },
  },
  // Auto-update / download base. Points at the repo's GitHub Releases so the
  // updater can fetch update.json + patches published by desktop-release.yml.
  release: {
    baseUrl: "https://github.com/logic2020/pi-browser-dashboard/releases/latest/download/",
  },
} satisfies ElectrobunConfig
