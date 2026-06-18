import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { Context, Effect, Layer } from "effect"
import { isSafeSegment } from "../claude-config/claude-config.core"
import { ProjectsService } from "../projects/projects.repo"
import {
  mergePidSettings,
  type PidSettings,
  type PidSettingsPatch,
  parsePidSettings,
  serializePidSettings,
} from "./pid-settings.core"

export type PidSettingsError = "not_found" | "forbidden"

// Per-project settings live alongside the project's other pid state, in
// <project>/.pid/settings.json (the same .pid dir that holds extensions-state).
const pidSettingsPathFor = (projectPath: string): string =>
  join(projectPath, ".pid", "settings.json")

type PidSettingsServiceApi = {
  readonly readProject: (projectId: string) => Effect.Effect<PidSettings, PidSettingsError, never>
  readonly updateProject: (
    projectId: string,
    patch: PidSettingsPatch,
  ) => Effect.Effect<PidSettings, PidSettingsError, never>
}

export class PidSettingsService extends Context.Tag("PidSettingsService")<
  PidSettingsService,
  PidSettingsServiceApi
>() {}

const tryReadText = async (path: string): Promise<string | null> => {
  try {
    return await readFile(path, "utf8")
  } catch {
    return null
  }
}

// tmp+rename so a concurrent reader never observes a half-written file (mirrors
// the canvas/roster rewrite pattern).
const writeAtomic = async (path: string, body: string): Promise<void> => {
  await mkdir(join(path, ".."), { recursive: true })
  const tmp = `${path}.${process.pid}.tmp`
  await writeFile(tmp, body, "utf8")
  await rename(tmp, path)
}

export const PidSettingsRepoLive: Layer.Layer<PidSettingsService, never, ProjectsService> =
  Layer.effect(
    PidSettingsService,
    Effect.gen(function* () {
      const projects = yield* ProjectsService

      const resolvePath = (projectId: string) =>
        Effect.gen(function* () {
          if (!isSafeSegment(projectId)) return yield* Effect.fail<PidSettingsError>("forbidden")
          const list = yield* projects.list()
          const proj = list.find((p) => p.id === projectId)
          if (!proj) return yield* Effect.fail<PidSettingsError>("not_found")
          return pidSettingsPathFor(proj.path)
        })

      return {
        readProject: (projectId) =>
          Effect.gen(function* () {
            const path = yield* resolvePath(projectId)
            const text = yield* Effect.promise(() => tryReadText(path))
            return parsePidSettings(text)
          }),

        updateProject: (projectId, patch) =>
          Effect.gen(function* () {
            const path = yield* resolvePath(projectId)
            const text = yield* Effect.promise(() => tryReadText(path))
            const next = mergePidSettings(parsePidSettings(text), patch)
            yield* Effect.promise(() => writeAtomic(path, serializePidSettings(next)))
            return next
          }),
      }
    }),
  )

export const PidSettingsRepoTest = (
  store: Record<string, PidSettings> = {},
): Layer.Layer<PidSettingsService> =>
  Layer.succeed(PidSettingsService, {
    readProject: (id) => {
      if (!isSafeSegment(id)) return Effect.fail<PidSettingsError>("forbidden")
      return Effect.succeed(store[id] ?? parsePidSettings(null))
    },
    updateProject: (id, patch) => {
      if (!isSafeSegment(id)) return Effect.fail<PidSettingsError>("forbidden")
      const next = mergePidSettings(store[id] ?? parsePidSettings(null), patch)
      store[id] = next
      return Effect.succeed(next)
    },
  })
