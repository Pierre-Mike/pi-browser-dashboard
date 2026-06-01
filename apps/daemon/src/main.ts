import { Effect } from "effect"
import app, { mountExtensions, websocket } from "./api"
import { IssueDriverService } from "./features/issue-driver/issue-driver.repo"
import { SessionRegistry } from "./features/sessions/sessions.repo"
import { loadExtensions } from "./platform/extensions/loader"
import { appRuntime } from "./platform/runtime"

const PORT = Number(process.env.PORT ?? 8787)
const ISSUE_POLL_MS = Number(process.env.PID_ISSUE_POLL_MS ?? 120_000)

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

// Discover, permission-gate and mount GLOBAL extensions into the shared
// registry at boot. Local (per-project) extensions are NOT scanned here — they
// are discovered on demand per project by resolveProjectExtensions so a panel
// installed in one repo never leaks into another (local:null skips the local
// scan). A failure here must never block daemon boot.
try {
  await loadExtensions({ roots: { local: null } })
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

const shutdown = async (): Promise<void> => {
  if (issueDriverTimer) clearInterval(issueDriverTimer)
  server.stop()
  await appRuntime.dispose()
  process.exit(0)
}

process.on("SIGINT", () => {
  void shutdown()
})
process.on("SIGTERM", () => {
  void shutdown()
})
