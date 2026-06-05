import { Effect } from "effect"
import app, { mountExtensions, websocket } from "./api"
import { IssueDriverService } from "./features/issue-driver/issue-driver.repo"
import { SessionRegistry } from "./features/sessions/sessions.repo"
import { TunnelService } from "./features/tunnel/tunnel.repo"
import { loadExtensions } from "./platform/extensions/loader"
import { appRuntime } from "./platform/runtime"

const PORT = Number(process.env.PORT ?? 8787)
const ISSUE_POLL_MS = Number(process.env.PID_ISSUE_POLL_MS ?? 120_000)
// Every boot starts one Cloudflare quick-tunnel. Set PID_TUNNEL_AUTOSTART=0 to
// opt out (e.g. tests / offline dev).
const TUNNEL_AUTOSTART = (process.env.PID_TUNNEL_AUTOSTART ?? "1") !== "0"

// Touch the runtime so SessionRegistryLive is constructed (and its watchers
// armed) before the first request arrives.
await appRuntime.runPromise(
  Effect.gen(function* () {
    yield* SessionRegistry
  }),
)

// Periodic GitHub-issue poll. Spawning is gated by globalCap/perRepoCap in
// the driver itself; this just provides the heartbeat. Setting the env var
// to 0 disables polling (useful for tests / disabling locally).
let issueDriverTimer: ReturnType<typeof setInterval> | null = null
if (ISSUE_POLL_MS > 0) {
  const runTick = (): void => {
    void appRuntime.runPromise(Effect.flatMap(IssueDriverService, (s) => s.tick())).catch((err) => {
      console.error("[issue-driver] tick failed", err)
    })
  }
  // Fire one tick immediately so the user doesn't wait 2 minutes after boot.
  runTick()
  issueDriverTimer = setInterval(runTick, ISSUE_POLL_MS)
}

// Discover, permission-gate and mount extensions from the global/local dirs.
// A failure here must never block daemon boot.
try {
  await loadExtensions()
  mountExtensions(app)
} catch (err) {
  console.error("[extensions] load failed", err)
}

const server = Bun.serve({
  port: PORT,
  fetch: app.fetch,
  websocket,
  idleTimeout: 0,
})

console.error(`daemon up: http://localhost:${server.port}`)

// Bring up a single Cloudflare quick-tunnel so the dashboard is reachable from
// a public URL on every boot. cloudflared failures (e.g. not installed) must
// never block the daemon — the tunnel state just reports the error and the UI
// surfaces it.
if (TUNNEL_AUTOSTART) {
  void appRuntime
    .runPromise(Effect.flatMap(TunnelService, (s) => s.start()))
    .then((st) => {
      if (st.status === "running") console.error(`tunnel up: ${st.url}`)
      else console.error(`[tunnel] not running: ${st.error ?? st.status}`)
    })
    .catch((err) => console.error("[tunnel] start failed", err))
}

const shutdown = async (): Promise<void> => {
  if (issueDriverTimer) clearInterval(issueDriverTimer)
  server.stop()
  await appRuntime.runPromise(Effect.flatMap(TunnelService, (s) => s.stop())).catch(() => undefined)
  await appRuntime.dispose()
  process.exit(0)
}

process.on("SIGINT", () => {
  void shutdown()
})
process.on("SIGTERM", () => {
  void shutdown()
})
