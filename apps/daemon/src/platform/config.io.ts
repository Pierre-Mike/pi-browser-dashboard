import { homedir } from "node:os"
import { join } from "node:path"
import { Context, Effect, Layer } from "effect"

export type PidConfig = {
  readonly projectsRoot: string
  readonly claudeConfigDir: string
  readonly appPort: number
  /** Local port the Cloudflare quick-tunnel exposes publicly (the dashboard). */
  readonly tunnelPort: number
  /**
   * Prefix applied to every zellij session name this daemon derives (see
   * `terminal.core.ts`'s `prefixedZellijSession`). Empty by default so a
   * daemon's zellij sessions are, by design, global to the OS user — the
   * dashboard's whole point is to attach to sessions the user already has
   * open (or that shared tooling like `voice-event.sh` also targets). Set
   * PID_ZELLIJ_PREFIX for any daemon that must NOT touch those sessions: a
   * test run, an e2e run, a second checkout, or a second `pid-dashboard` on
   * another port.
   */
  readonly zellijPrefix: string
  /**
   * How often (ms) to classify a screen dump for the zellij sessions this
   * daemon owns that have NO attached terminal WebSocket, so an unattended
   * `claude` / `pi` still gets a state. `0` disables the poller entirely — no
   * timer, and the refresh-on-read hook on GET /terminal/states stays inert
   * too.
   *
   * Deliberately lazy compared with the 400ms throttle the attached path uses:
   * every polled session costs TWO `zellij` subprocess spawns per pass
   * (`action list-panes`, then `action dump-screen --pane-id …`), where the
   * attached path costs nothing beyond a regex over bytes it already has.
   */
  readonly terminalPollMs: number
  /**
   * Add ONE pointer sentence to a dispatched claude session's system prompt
   * (`--append-system-prompt`) naming the agent skill's url and the `pid`
   * binary — see platform/agent-discovery.core.ts.
   *
   * Off by default, and deliberately so: env vars and a shim are inert until
   * an agent looks for them, while a prompt line changes what every session
   * this daemon spawns is told. Set PID_AGENT_POINTER=1 to accept that
   * trade-off. The env half of discovery is always on; only the sentence is
   * gated. pi has no `--append-system-prompt` equivalent, so this only
   * affects the claude path.
   */
  readonly agentPointer: boolean
}

// See `terminalPollMs`. 15s is slower than a human notices a chip change but
// fast enough that a rule with a dwell window still sees the transition.
const DEFAULT_TERMINAL_POLL_MS = 15_000

type ConfigServiceApi = {
  readonly get: () => Effect.Effect<PidConfig, never, never>
}

export class ConfigService extends Context.Tag("ConfigService")<
  ConfigService,
  ConfigServiceApi
>() {}

const buildConfig = (): PidConfig => {
  const home = homedir()
  return {
    projectsRoot: process.env.PID_PROJECTS_ROOT ?? join(home, "Github"),
    claudeConfigDir: process.env.CLAUDE_CONFIG_DIR ?? join(home, ".claude"),
    appPort: Number(process.env.PORT ?? 8787),
    // Default to the web dashboard dev port so the tunnel URL serves the UI.
    tunnelPort: Number(process.env.PID_TUNNEL_PORT ?? process.env.PID_WEB_PORT ?? 5173),
    zellijPrefix: process.env.PID_ZELLIJ_PREFIX ?? "",
    terminalPollMs: Number(process.env.PID_TERMINAL_POLL_MS ?? DEFAULT_TERMINAL_POLL_MS),
    agentPointer: process.env.PID_AGENT_POINTER === "1",
  }
}

export const ConfigIoLive: Layer.Layer<ConfigService> = Layer.succeed(ConfigService, {
  get: () => Effect.succeed(buildConfig()),
})

export const ConfigIoTest = (overrides?: Partial<PidConfig>): Layer.Layer<ConfigService> => {
  const defaults = buildConfig()
  const merged = { ...defaults, ...overrides }
  return Layer.succeed(ConfigService, {
    get: () => Effect.succeed(merged),
  })
}
