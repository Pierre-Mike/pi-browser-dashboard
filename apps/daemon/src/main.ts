import { Effect } from "effect"
import app, { websocket } from "./api"
import { IssueDriverService } from "./features/issue-driver/issue-driver.repo"
import { SessionRegistry } from "./features/sessions/sessions.repo"
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
