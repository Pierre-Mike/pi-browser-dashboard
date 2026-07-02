#!/usr/bin/env bun
// pid-dashboard — one-command install/run of the pi-browser-dashboard SPA +
// daemon on a single port. `bunx pid-dashboard` fetches this package and runs
// it directly (Bun executes TypeScript natively — no build step needed here).
//
// The bundled `apps/web` build lives in `dist-web/`, a sibling of this file's
// directory whether run from source (apps/cli/src/main.ts -> apps/cli/dist-web)
// or once packed for publish (apps/cli/dist-web ships via package.json "files").
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { startDaemon } from "@pid/daemon/server"
import { parseCliArgs } from "./cli.core"

const HELP = `pid-dashboard — browser dashboard for Claude Code background sessions

Usage: pid-dashboard [options]

Options:
  -p, --port <n>   Port to listen on (default: 8787)
  --no-open        Don't open the browser automatically
  -h, --help       Show this help
`

const openBrowser = (url: string): void => {
  const cmd =
    process.platform === "darwin"
      ? ["open", url]
      : process.platform === "win32"
        ? ["cmd", "/c", "start", "", url]
        : ["xdg-open", url]
  Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" })
}

const main = async (): Promise<void> => {
  const opts = parseCliArgs(process.argv.slice(2))
  if (opts.help) {
    console.error(HELP)
    return
  }

  const staticDir = join(dirname(fileURLToPath(import.meta.url)), "../dist-web")
  const handle = await startDaemon({ port: opts.port, tunnel: false, staticDir })
  console.error(`pid-dashboard running at http://localhost:${handle.port}`)
  if (opts.open) openBrowser(`http://localhost:${handle.port}`)

  const shutdown = async (): Promise<void> => {
    await handle.stop()
    process.exit(0)
  }
  process.on("SIGINT", () => void shutdown())
  process.on("SIGTERM", () => void shutdown())
}

await main()
