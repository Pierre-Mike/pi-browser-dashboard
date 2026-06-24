import { type DaemonHandle, startDaemon } from "@pid/daemon/server"
import { BrowserWindow } from "electrobun/bun"
import { daemonLaunchEnv, webviewUrl } from "./desktopEnv"
import { makeShutdown } from "./lifecycle"

// Electrobun main process (Bun). Open the window FIRST so the UI always appears
// and keeps the event loop alive, THEN boot the embedded daemon in the
// background. Awaiting the daemon before creating the window risks an early
// event-loop exit (no window ever shown) if daemon boot rejects in the bundle.
//
// The window loads the production SPA build via the `views://` protocol; the SPA
// (built with VITE_API_URL=http://localhost:8787) retries its daemon calls via
// react-query until the embedded daemon finishes booting a moment later.
const win = new BrowserWindow({
  title: "pi dashboard",
  url: webviewUrl(),
  frame: { width: 1280, height: 800, x: 0, y: 0 },
})

let daemon: DaemonHandle | null = null
void startDaemon(daemonLaunchEnv())
  .then((handle) => {
    daemon = handle
  })
  .catch((err) => console.error("[desktop] daemon boot failed", err))

const shutdown = makeShutdown(() => daemon)

process.on("exit", shutdown)
process.on("SIGINT", () => {
  shutdown()
  process.exit(0)
})

export { win }
