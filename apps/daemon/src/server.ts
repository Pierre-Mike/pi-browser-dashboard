import type { Server } from "bun"
import { Effect } from "effect"
import app, { buildApp, mountExtensions, websocket } from "./api"
import { IssueDriverService } from "./features/issue-driver/issue-driver.repo"
import { SessionRegistry } from "./features/sessions/sessions.repo"
import { TunnelService } from "./features/tunnel/tunnel.repo"
import { loadExtensions } from "./platform/extensions/loader"
import { appRuntime } from "./platform/runtime"

export type StartDaemonOptions = {
  // Port to bind. 0 lets the OS pick a free port (handy for tests).
  port?: number
  // Start a Cloudflare quick-tunnel on boot (public reachability). Off for the
  // embedded desktop daemon and for tests.
  tunnel?: boolean
  // GitHub-issue poll interval in ms. 0 disables the heartbeat.
  issuePollMs?: number
  // Extra origins to allow through CORS. Applied to process.env before the
  // first request so the per-request origin callback (cors.core.ts) sees them.
  corsOrigins?: string[]
  // Allow any `views://` origin (Electrobun webview). Sets PID_ALLOW_VIEWS_ORIGIN.
  allowViewsOrigin?: boolean
  // Directory of a pre-built apps/web SPA to serve from "/" (moves the API
  // behind "/__api" — see api.ts's buildApp). Set by the pid-dashboard CLI;
  // every other caller leaves this unset and keeps the API at the bare root.
  staticDir?: string
}

export type DaemonHandle = {
  port: number
  stop: () => Promise<void>
}

export type DaemonConfig = {
  port: number
  issuePollMs: number
  tunnel: boolean
}

type DaemonConfigEnv = {
  PORT?: string
  PID_ISSUE_POLL_MS?: string
  PID_TUNNEL_AUTOSTART?: string
}

const numEnv = (raw: string | undefined, fallback: number): number => Number(raw ?? fallback)
// PID_TUNNEL_AUTOSTART defaults on; only "0" disables.
const tunnelFlag = (raw: string | undefined): boolean => (raw ?? "1") !== "0"

// Pure: resolve runtime config from explicit options falling back to env. The
// CLI passes no options (pure env); the desktop app passes explicit values.
export const resolveDaemonConfig = (
  opts: StartDaemonOptions,
  env: DaemonConfigEnv,
): DaemonConfig => ({
  port: opts.port ?? numEnv(env.PORT, 8787),
  issuePollMs: opts.issuePollMs ?? numEnv(env.PID_ISSUE_POLL_MS, 120_000),
  tunnel: opts.tunnel ?? tunnelFlag(env.PID_TUNNEL_AUTOSTART),
})

// Pure: merge new CORS origins onto an existing PID_CORS_ORIGINS value.
export const mergeCorsOrigins = (existing: string | undefined, add: string[] | undefined): string =>
  [existing, ...(add ?? [])].filter(Boolean).join(",")

// Apply CORS overrides to process.env before serving so the per-request origin
// callback (cors.core.ts) picks them up — the api module is already imported.
const applyCorsEnv = (opts: StartDaemonOptions): void => {
  if (opts.corsOrigins?.length) {
    process.env.PID_CORS_ORIGINS = mergeCorsOrigins(process.env.PID_CORS_ORIGINS, opts.corsOrigins)
  }
  if (opts.allowViewsOrigin) process.env.PID_ALLOW_VIEWS_ORIGIN = "1"
}

// Start the periodic GitHub-issue poll heartbeat. Spawning is gated by
// globalCap/perRepoCap in the driver itself. Returns the timer (or null).
const startIssuePoll = (issuePollMs: number): ReturnType<typeof setInterval> | null => {
  if (issuePollMs <= 0) return null
  const runTick = (): void => {
    void appRuntime
      .runPromise(Effect.flatMap(IssueDriverService, (s) => s.tick()))
      .catch((err) => console.error("[issue-driver] tick failed", err))
  }
  runTick()
  return setInterval(runTick, issuePollMs)
}

// Bring up the Cloudflare quick-tunnel. Failures must never block the daemon.
const startTunnel = (): void => {
  void appRuntime
    .runPromise(Effect.flatMap(TunnelService, (s) => s.start()))
    .then((st) =>
      console.error(st.status === "running" ? `tunnel up: ${st.url}` : `[tunnel] ${st.status}`),
    )
    .catch((err) => console.error("[tunnel] start failed", err))
}

// Imperative shell: boot the daemon and return a handle. Shared by the CLI
// entrypoint (main.ts) and the Electrobun desktop main process, which runs it
// in-process with the tunnel off.
export const startDaemon = async (opts: StartDaemonOptions = {}): Promise<DaemonHandle> => {
  const { port, issuePollMs, tunnel } = resolveDaemonConfig(opts, process.env)
  applyCorsEnv(opts)

  // Touch the runtime so SessionRegistryLive is constructed (watchers armed)
  // before the first request arrives.
  await appRuntime.runPromise(
    Effect.gen(function* () {
      yield* SessionRegistry
    }),
  )

  const issueDriverTimer = startIssuePoll(issuePollMs)

  // Discover, permission-gate and mount extensions. A failure here must never
  // block daemon boot.
  try {
    await loadExtensions()
    mountExtensions(app)
  } catch (err) {
    console.error("[extensions] load failed", err)
  }

  const staticDir = opts.staticDir ?? process.env.PID_STATIC_DIR
  const finalApp = buildApp(staticDir)
  const server: Server = Bun.serve({ port, fetch: finalApp.fetch, websocket, idleTimeout: 0 })
  console.error(`daemon up: http://localhost:${server.port}`)
  if (tunnel) startTunnel()

  const stop = async (): Promise<void> => {
    if (issueDriverTimer) clearInterval(issueDriverTimer)
    server.stop()
    if (tunnel) {
      await appRuntime
        .runPromise(Effect.flatMap(TunnelService, (s) => s.stop()))
        .catch(() => undefined)
    }
    await appRuntime.dispose()
  }

  return { port: server.port, stop }
}
