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
      // Only proxy paths the SPA cannot own. `/sessions`, `/dispatch`,
      // `/projects` are SPA routes — proxying them swallows hard refreshes
      // and returns daemon JSON. The client uses absolute VITE_API_URL for
      // API calls, so no proxy entry is needed for those.
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
