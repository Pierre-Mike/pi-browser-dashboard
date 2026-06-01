import { homedir } from "node:os"
import { join } from "node:path"
import { Context, Effect, Layer } from "effect"

export type PidConfig = {
  readonly projectsRoot: string
  readonly claudeConfigDir: string
  readonly appPort: number
}

export type ConfigServiceApi = {
  readonly get: () => Effect.Effect<PidConfig, never, never>
}

export class ConfigService extends Context.Tag("ConfigService")<
  ConfigService,
  ConfigServiceApi
>() {}

// The projects root, resolved the same way buildConfig() does. Exported so
// non-Effect code (e.g. the plain Hono extensions routes) can map a projectId
// to its path without standing up the ConfigService.
export const defaultProjectsRoot = (): string =>
  process.env.PID_PROJECTS_ROOT ?? join(homedir(), "Github")

const buildConfig = (): PidConfig => {
  const home = homedir()
  return {
    projectsRoot: defaultProjectsRoot(),
    claudeConfigDir: process.env.CLAUDE_CONFIG_DIR ?? join(home, ".claude"),
    appPort: Number(process.env.PORT ?? 8787),
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
