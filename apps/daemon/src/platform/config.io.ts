import { homedir } from "node:os"
import { join } from "node:path"
import { Context, Effect, Layer } from "effect"
import { cleanZellijEnv } from "./child-env"

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
  /**
   * The OS user's home directory, as `node:os` reports it. Handed out so a slice
   * that needs a fallback cwd (a session whose roster entry carries none, the
   * global terminal) receives a value instead of reaching for `HOME` itself.
   */
  readonly homeDir: string
  /**
   * Where the Orchestrator repo is — the cwd the supervisor boots in. Starting
   * there is what makes that session an orchestrator (the repo's CLAUDE.md is
   * the supervisor instruction set, and its bootstrap script is repo-relative).
   * PID_ORCHESTRATOR_DIR overrides; the default is `<home>/Github/Orchestrator`,
   * and `/` only when nothing is known, because `Bun.spawn` rejects an empty cwd.
   *
   * Resolved here, but NOT checked here: whether the directory exists is a
   * request-time question (it can appear or vanish while the daemon runs), so
   * the terminal slice still verifies it before spawning — see
   * `resolveOrchestratorCwd`.
   */
  readonly orchestratorDir: string
  /**
   * The environment to hand a child process this daemon spawns: the daemon's own
   * environment with zellij's per-session markers scrubbed (see
   * platform/child-env.ts for why those three and not the ZELLIJ_* config paths).
   *
   * Handed out as a value so the slices that spawn — the terminal WS bridge, the
   * pane write surface, a `zellij` read — never read the environment themselves.
   */
  readonly childEnv: Readonly<Record<string, string>>
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

const orchestratorDirOf = (input: {
  readonly configured: string | undefined
  readonly home: string
}): string => {
  if (input.configured !== undefined && input.configured.length > 0) return input.configured
  return input.home.length > 0 ? join(input.home, "Github", "Orchestrator") : "/"
}

const buildConfig = (): PidConfig => {
  const home = homedir()
  return {
    homeDir: home,
    orchestratorDir: orchestratorDirOf({ configured: process.env.PID_ORCHESTRATOR_DIR, home }),
    childEnv: cleanZellijEnv(process.env),
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
