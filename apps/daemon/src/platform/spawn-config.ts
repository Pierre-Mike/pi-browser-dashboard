// The spawn-shaped values a slice needs from the config funnel, resolved once.
//
// Same shape, same reasons, as `zellij-prefix.ts` next door: the environment is
// read in exactly one place (`config.io.ts`) and slices receive VALUES, so a
// slice needs a value rather than a dependency on the config service. Resolved
// synchronously because `ConfigService.get()` is a pure `Effect.succeed` with no
// async acquisition, and the terminal slice's handlers are constructed at module
// load, before any request can arrive.
//
// This is what replaced the six environment reads that used to sit inside
// `features/terminal/terminal.routes.ts`: a fallback home directory, the
// Orchestrator repo path, and the scrubbed environment every child spawn gets.
import { Effect } from "effect"
import { ConfigIoLive, ConfigService } from "./config.io"

export type SpawnConfig = {
  readonly homeDir: string
  readonly orchestratorDir: string
  readonly childEnv: Readonly<Record<string, string>>
}

export const readSpawnConfig = (): SpawnConfig => {
  const config = Effect.runSync(
    Effect.provide(
      Effect.flatMap(ConfigService, (s) => s.get()),
      ConfigIoLive,
    ),
  )
  return {
    homeDir: config.homeDir,
    orchestratorDir: config.orchestratorDir,
    childEnv: config.childEnv,
  }
}
