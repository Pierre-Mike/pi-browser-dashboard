import { startDaemon } from "./server"

// Thin CLI entrypoint: read env and delegate to the shared startDaemon shell.
// Behaviour is unchanged from the previous inline boot (PORT, PID_ISSUE_POLL_MS,
// PID_TUNNEL_AUTOSTART all still honoured by startDaemon's defaults).
const handle = await startDaemon()

const shutdown = async (): Promise<void> => {
  await handle.stop()
  process.exit(0)
}

process.on("SIGINT", () => {
  void shutdown()
})
process.on("SIGTERM", () => {
  void shutdown()
})
