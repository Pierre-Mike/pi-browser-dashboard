import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect, Layer } from "effect"
import { ConfigRepoTest } from "../../platform/config.repo"
import { DEFAULT_GLOBAL_SETTINGS } from "./global-settings.core"
import {
  GLOBAL_SETTINGS_REL_PATH,
  GlobalSettingsRepoLive,
  GlobalSettingsService,
} from "./global-settings.repo"

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pid-global-"))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const layer = () =>
  GlobalSettingsRepoLive.pipe(Layer.provide(ConfigRepoTest({ claudeConfigDir: dir })))

const run = <A>(eff: Effect.Effect<A, never, GlobalSettingsService>): Promise<A> =>
  Effect.runPromise(Effect.provide(eff, layer()))

describe("GlobalSettingsRepoLive", () => {
  it("read returns defaults when no file exists", async () => {
    const got = await run(Effect.flatMap(GlobalSettingsService, (s) => s.read()))
    expect(got).toEqual(DEFAULT_GLOBAL_SETTINGS)
  })

  it("update persists a patch and read sees it back", async () => {
    const updated = await run(
      Effect.flatMap(GlobalSettingsService, (s) => s.update({ git: { defaultBranch: "trunk" } })),
    )
    expect(updated.git.defaultBranch).toBe("trunk")

    const reread = await run(Effect.flatMap(GlobalSettingsService, (s) => s.read()))
    expect(reread.git.defaultBranch).toBe("trunk")
    expect(reread.git.remoteName).toBe(DEFAULT_GLOBAL_SETTINGS.git.remoteName)
  })

  it("writes to <claudeConfigDir>/<GLOBAL_SETTINGS_REL_PATH>", async () => {
    await run(
      Effect.flatMap(GlobalSettingsService, (s) => s.update({ network: { appPort: 9191 } })),
    )
    const text = await readFile(join(dir, GLOBAL_SETTINGS_REL_PATH), "utf8")
    expect(JSON.parse(text).network.appPort).toBe(9191)
  })
})
