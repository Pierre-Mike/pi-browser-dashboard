import { homedir } from "node:os"
import { join } from "node:path"
import { Context, Effect, Layer } from "effect"

export type PidConfig = {
  readonly projectsRoot: string
  readonly claudeConfigDir: string
  readonly appPort: number
  /** Local port the Cloudflare quick-tunnel exposes publicly (the dashboard). */
  readonly tunnelPort: number
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
  }
}

export const ConfigRepoLive: Layer.Layer<ConfigService> = Layer.succeed(ConfigService, {
  get: () => Effect.succeed(buildConfig()),
})

export const ConfigRepoTest = (overrides?: Partial<PidConfig>): Layer.Layer<ConfigService> => {
  const defaults = buildConfig()
  const merged = { ...defaults, ...overrides }
  return Layer.succeed(ConfigService, {
    get: () => Effect.succeed(merged),
  })
}
