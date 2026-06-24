import { startDaemon } from "@pid/daemon/server"
import { BrowserWindow } from "electrobun/bun"
import { daemonLaunchEnv, webviewUrl } from "./desktopEnv"

// Electrobun main process (Bun). Boots the daemon in-process with the public
// tunnel off and CORS opened for the webview origin, then opens a window that
// loads the production SPA build via the `views://` protocol. The SPA is built
// with VITE_API_URL=http://localhost:8787 so it talks straight to this daemon.
const daemon = await startDaemon(daemonLaunchEnv())

const win = new BrowserWindow({
  title: "pi dashboard",
  url: webviewUrl(),
  frame: { width: 1280, height: 800, x: 0, y: 0 },
})

const shutdown = (): void => {
  void daemon.stop()
}

process.on("exit", shutdown)
process.on("SIGINT", () => {
  shutdown()
  process.exit(0)
})

export { win }
