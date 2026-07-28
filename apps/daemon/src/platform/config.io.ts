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
}

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
