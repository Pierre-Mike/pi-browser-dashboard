import { Effect } from "effect"
import app, {
  API_PREFIX,
  buildApp,
  mountExtensions,
  rulesEngine,
  terminalPoller,
  websocket,
} from "./api"
import { IssueDriverService } from "./features/issue-driver/issue-driver.io"
import { SessionRegistry } from "./features/sessions/sessions.io"
import { TunnelService } from "./features/tunnel/tunnel.io"
import { agentDiscovery } from "./platform/agent-discovery.io"
import { ConfigIoLive, ConfigService } from "./platform/config.io"
import { loadExtensions } from "./platform/extensions/loader"
import { appRuntime } from "./platform/runtime"

export type StartDaemonOptions = {
  // Port to bind. 0 lets the OS pick a free port (handy for tests).
  port?: number
  // Start a Cloudflare quick-tunnel on boot (public reachability). Off for the
  // CLI distribution and for tests.
  tunnel?: boolean
  // GitHub-issue poll interval in ms. 0 disables the heartbeat.
  issuePollMs?: number
  // State-change rules dwell sweep interval in ms. 0 disables it (a rule with
  // no `forMs` still fires off bus events; a dwell rule just won't be swept
  // until the next boot with a non-zero interval).
  rulesTickMs?: number
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
  rulesTickMs: number
  tunnel: boolean
}

type DaemonConfigEnv = {
  PORT?: string
  PID_ISSUE_POLL_MS?: string
  PID_RULES_TICK_MS?: string
  PID_TUNNEL_AUTOSTART?: string
}

const numEnv = (raw: string | undefined, fallback: number): number => Number(raw ?? fallback)
// PID_TUNNEL_AUTOSTART defaults on; only "0" disables.
const tunnelFlag = (raw: string | undefined): boolean => (raw ?? "1") !== "0"

// An explicit option wins; otherwise fall back to the env var (numEnv's own
// fallback if that's unset too). Factored out so resolveDaemonConfig's own
// branch count doesn't grow one `??` per config field.
const resolveNum = ({
  explicit,
  raw,
  fallback,
}: {
  readonly explicit: number | undefined
  readonly raw: string | undefined
  readonly fallback: number
}): number => explicit ?? numEnv(raw, fallback)

// Pure: resolve runtime config from explicit options falling back to env. The
// dev daemon passes no options (pure env); the pid-dashboard CLI passes explicit
// values.
export const resolveDaemonConfig = (
  opts: StartDaemonOptions,
  env: DaemonConfigEnv,
): DaemonConfig => ({
  port: resolveNum({ explicit: opts.port, raw: env.PORT, fallback: 8787 }),
  issuePollMs: resolveNum({
    explicit: opts.issuePollMs,
    raw: env.PID_ISSUE_POLL_MS,
    fallback: 120_000,
  }),
  rulesTickMs: resolveNum({
    explicit: opts.rulesTickMs,
    raw: env.PID_RULES_TICK_MS,
    fallback: 30_000,
  }),
  tunnel: opts.tunnel ?? tunnelFlag(env.PID_TUNNEL_AUTOSTART),
})

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

// Periodic dwell sweep for state-change rules — the belt to `rulesEngine`'s
// own bus-subscription suspenders (see rules.io.ts's own header on why
// neither alone is enough). Off by construction until a rules.json exists
// AND sets `enabled: true`; see AGENTS.md "State-change rules".
const startRulesTick = (rulesTickMs: number): ReturnType<typeof setInterval> | null => {
  if (rulesTickMs <= 0) return null
  const runTick = (): void => {
    void rulesEngine.tick().catch((err) => console.error("[rules] tick failed", err))
  }
  return setInterval(runTick, rulesTickMs)
}

// Arm the unattended terminal-state poller: a screen dump for every zellij
// session this daemon owns that has no attached WebSocket, so a `claude`/`pi`
// nobody has opened in the dashboard still gets classified. The interval comes
// from the typed config funnel (`PID_TERMINAL_POLL_MS`, default 15s, `0`
// disables) — resolved here, in the composition root, the same way
// platform/zellij-prefix.ts resolves the prefix: ConfigService.get() is a pure
// Effect.succeed with no async acquisition, and ConfigIoLive is not part of
// appRuntime's own layer set.
const startTerminalPoll = (): void => {
  const { terminalPollMs } = Effect.runSync(
    Effect.provide(
      Effect.flatMap(ConfigService, (s) => s.get()),
      ConfigIoLive,
    ),
  )
  terminalPoller.start({ intervalMs: terminalPollMs })
}

// Tell every session this daemon spawns from now on where this daemon is:
// PID_URL / PID_SKILL_URL / PID_BIN, plus a `pid` shim the session can run by
// absolute path (platform/agent-discovery.io.ts). Armed AFTER Bun.serve so the
// url names the port actually bound — `--port`, `PORT` and `port: 0` are all
// correct — and with the api prefix that matches how this process serves the
// API, since /agent-skill.md only answers behind /__api once the SPA owns "/".
// Config comes through the same funnel startTerminalPoll uses.
const armAgentDiscovery = ({
  port,
  staticDir,
}: {
  readonly port: number
  readonly staticDir: string | undefined
}): void => {
  const { claudeConfigDir, agentPointer } = Effect.runSync(
    Effect.provide(
      Effect.flatMap(ConfigService, (s) => s.get()),
      ConfigIoLive,
    ),
  )
  agentDiscovery.arm({
    port,
    apiPrefix: staticDir ? API_PREFIX : "",
    claudeConfigDir,
    withPointer: agentPointer,
  })
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

// Imperative shell: boot the daemon and return a handle. Shared by the dev
// entrypoint (main.ts) and the pid-dashboard CLI, which runs it in-process with
// the tunnel off and the SPA served from staticDir.
export const startDaemon = async (opts: StartDaemonOptions = {}): Promise<DaemonHandle> => {
  // Name the env keys the pure resolver reads instead of handing it the whole
  // ambient environment (typed config at the boundary).
  const { port, issuePollMs, rulesTickMs, tunnel } = resolveDaemonConfig(opts, {
    PORT: process.env.PORT,
    PID_ISSUE_POLL_MS: process.env.PID_ISSUE_POLL_MS,
    PID_RULES_TICK_MS: process.env.PID_RULES_TICK_MS,
    PID_TUNNEL_AUTOSTART: process.env.PID_TUNNEL_AUTOSTART,
  })

  // Arm the rules engine's SSE-bus subscription BEFORE touching
  // SessionRegistry below: the registry's own boot-time jobs-dir scan and
  // roster reconciliation publish `session.created` / `session.state` for
  // every session that already exists, and this ordering is what lets the
  // engine observe that initial replay instead of only ever seeing sessions
  // that change state *after* boot. See rules.io.ts's own header.
  //
  // The same ordering matters just as much for the SCREEN reading, and for a
  // sharper reason: `startTerminalPoll()` below publishes `terminal.state` only
  // when a classification CHANGES, so a pass that ran before this subscription
  // existed would never be re-announced. The engine would then be blind to that
  // pane until its screen changed again — which for a session parked at an
  // unanswered prompt is precisely never.
  rulesEngine.start()

  // Touch the runtime so SessionRegistryLive is constructed (watchers armed)
  // before the first request arrives.
  await appRuntime.runPromise(
    Effect.gen(function* () {
      yield* SessionRegistry
    }),
  )

  const issueDriverTimer = startIssuePoll(issuePollMs)
  const rulesTickTimer = startRulesTick(rulesTickMs)
  // After SessionRegistry above: the poller's first pass enumerates the roster,
  // so it wants the registry constructed rather than racing its boot scan.
  startTerminalPoll()

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
  // Inferred: Bun's `Server` is generic over the websocket data type, and
  // Bun.serve already knows it from `websocket`.
  const server = Bun.serve({ port, fetch: finalApp.fetch, websocket, idleTimeout: 0 })
  armAgentDiscovery({ port: server.port ?? port, staticDir })
  console.error(`daemon up: http://localhost:${server.port}`)
  if (tunnel) startTunnel()

  const stop = async (): Promise<void> => {
    // A stopped daemon must stop advertising itself: the next dispatch (a test
    // that boots a second daemon, say) arms discovery again with its own port.
    agentDiscovery.disarm()
    if (issueDriverTimer) clearInterval(issueDriverTimer)
    if (rulesTickTimer) clearInterval(rulesTickTimer)
    terminalPoller.stop()
    server.stop()
    if (tunnel) {
      await appRuntime
        .runPromise(Effect.flatMap(TunnelService, (s) => s.stop()))
        .catch(() => undefined)
    }
    await appRuntime.dispose()
  }

  // `server.port` is only absent for a unix-socket server; we always bind TCP,
  // so fall back to the port we asked for rather than widening the handle type.
  return { port: server.port ?? port, stop }
}
