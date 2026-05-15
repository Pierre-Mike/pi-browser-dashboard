import { TanStackRouterVite } from "@tanstack/router-plugin/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

const DAEMON = process.env.PID_DAEMON_URL ?? "http://localhost:8787"
const WEB_PORT = Number(process.env.PID_WEB_PORT ?? 5173)

export default defineConfig({
  plugins: [TanStackRouterVite(), react()],
  server: {
    port: WEB_PORT,
    strictPort: true,
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
