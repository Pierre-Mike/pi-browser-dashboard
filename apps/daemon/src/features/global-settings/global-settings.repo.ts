import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { Context, Effect, Layer } from "effect"
import { ConfigService } from "../../platform/config.repo"
import {
  type GlobalSettings,
  type GlobalSettingsPatch,
  mergeGlobalSettings,
  parseGlobalSettings,
  serializeGlobalSettings,
} from "./global-settings.core"

// The global settings file lives under the resolved Claude config dir, in a
// dashboard-owned subdir so it never collides with Claude's own files.
export const GLOBAL_SETTINGS_REL_PATH = "pid-dashboard/settings.json"

type GlobalSettingsServiceApi = {
  readonly read: () => Effect.Effect<GlobalSettings, never, never>
  readonly update: (patch: GlobalSettingsPatch) => Effect.Effect<GlobalSettings, never, never>
}

export class GlobalSettingsService extends Context.Tag("GlobalSettingsService")<
  GlobalSettingsService,
  GlobalSettingsServiceApi
>() {}

const tryReadText = async (path: string): Promise<string | null> => {
  try {
    return await readFile(path, "utf8")
  } catch {
    return null
  }
}

// tmp+rename so a concurrent reader never observes a half-written file (mirrors
// the pid-settings/canvas rewrite pattern).
const writeAtomic = async (path: string, body: string): Promise<void> => {
  await mkdir(join(path, ".."), { recursive: true })
  const tmp = `${path}.${process.pid}.tmp`
  await writeFile(tmp, body, "utf8")
  await rename(tmp, path)
}

export const GlobalSettingsRepoLive: Layer.Layer<GlobalSettingsService, never, ConfigService> =
  Layer.effect(
    GlobalSettingsService,
    Effect.gen(function* () {
      const config = yield* ConfigService
      const pathOf = Effect.map(config.get(), (c) =>
        join(c.claudeConfigDir, GLOBAL_SETTINGS_REL_PATH),
      )

      return {
        read: () =>
          Effect.gen(function* () {
            const path = yield* pathOf
            const text = yield* Effect.promise(() => tryReadText(path))
            return parseGlobalSettings(text)
          }),

        update: (patch) =>
          Effect.gen(function* () {
            const path = yield* pathOf
            const text = yield* Effect.promise(() => tryReadText(path))
            const next = mergeGlobalSettings(parseGlobalSettings(text), patch)
            yield* Effect.promise(() => writeAtomic(path, serializeGlobalSettings(next)))
            return next
          }),
      }
    }),
  )

// In-memory layer for routes tests: a single mutable cell.
export const GlobalSettingsRepoTest = (
  seed: GlobalSettings = parseGlobalSettings(null),
): Layer.Layer<GlobalSettingsService> =>
  Layer.sync(GlobalSettingsService, () => {
    let current = seed
    return {
      read: () => Effect.succeed(current),
      update: (patch) => {
        current = mergeGlobalSettings(current, patch)
        return Effect.succeed(current)
      },
    }
  })
