import { Effect } from "effect"
import app, { websocket } from "./api"
import { SessionRegistry } from "./features/sessions/sessions.repo"
import { appRuntime } from "./platform/runtime"

const PORT = Number(process.env.PORT ?? 8787)

// Touch the runtime so SessionRegistryLive is constructed (and its watchers
// armed) before the first request arrives.
await appRuntime.runPromise(
  Effect.gen(function* () {
    yield* SessionRegistry
  }),
)

const server = Bun.serve({
  port: PORT,
  fetch: app.fetch,
  websocket,
  idleTimeout: 0,
})

console.error(`daemon up: http://localhost:${server.port}`)

const shutdown = async (): Promise<void> => {
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
