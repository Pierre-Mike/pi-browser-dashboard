import { TanStackRouterVite } from "@tanstack/router-plugin/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { parseAllowedHosts } from "./src/server/allowedHosts"

const DAEMON = process.env.PID_DAEMON_URL ?? "http://localhost:8787"
const WEB_PORT = Number(process.env.PID_WEB_PORT ?? 5173)

export default defineConfig({
  plugins: [TanStackRouterVite(), react()],
  server: {
    port: WEB_PORT,
    strictPort: true,
    // The Cloudflare quick-tunnel (daemon) points at this dev server, so the
    // public URL serves Vite directly. Accept the rotating `*.trycloudflare.com`
    // hostnames (plus any PID_ALLOWED_HOSTS) instead of Vite's 403 host check.
    allowedHosts: parseAllowedHosts(process.env),
    proxy: {
      // `/sessions`, `/dispatch`, `/projects` are SPA routes that collide with
      // identically-named daemon REST routes — they can only coexist on the
      // same origin behind a prefix. The client routes daemon HTTP traffic
      // (REST + uploads + extension assets) through `/__api`, which the SPA
      // never owns; strip the prefix and forward to the daemon. This keeps
      // those requests same-origin (no CORS, no mixed content) over the tunnel.
      // e2e/direct callers set VITE_API_URL straight at the daemon and bypass
      // this entirely.
      //
      // `ws: true` so terminal/canvas WebSockets ride this same prefix (see
      // wsBase() in src/lib/apiBase.ts). node-http-proxy relays the upstream
      // `101 Switching Protocols` via Node's `httpServer.on("upgrade")` event,
      // which only fires when Vite runs under Node — never Bun (the dev/preview
      // scripts are kept off `--bun`; guarded by src/devRuntime.test.ts). This
      // is what lets the terminal work over the Cloudflare tunnel, which only
      // exposes this Vite origin, never the daemon's :8787.
      "/__api": {
        target: DAEMON,
        changeOrigin: true,
        ws: true,
        rewrite: (path) => path.replace(/^\/__api/, ""),
      },
      // SSE stays at the root `/events` path (sse.ts hits it same-origin; it is
      // not an SPA route, so no prefix is needed).
      "/events": {
        target: DAEMON,
        changeOrigin: true,
        ws: false,
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq) => {
            proxyReq.setHeader("Accept", "text/event-stream")
            proxyReq.setHeader("Cache-Control", "no-cache")
          })
        },
      },
    },
  },
})
