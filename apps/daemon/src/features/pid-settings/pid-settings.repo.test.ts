import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect, Layer } from "effect"
import { ConfigRepoTest } from "../../platform/config.repo"
import { ProjectsRepoLive } from "../projects/projects.repo"
import { parsePidSettings } from "./pid-settings.core"
import { PidSettingsRepoLive, PidSettingsService } from "./pid-settings.repo"

let root: string

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "pid-settings-"))
  await mkdir(join(root, "demo"), { recursive: true })
  await mkdir(join(root, "preset", ".pid"), { recursive: true })
  await writeFile(
    join(root, "preset", ".pid", "settings.json"),
    JSON.stringify({ defaultSkills: ["align", "tdd"] }),
  )
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

const withLayer = <A, E>(fx: Effect.Effect<A, E, PidSettingsService>): Promise<A> => {
  const projectsLayer = Layer.provide(ProjectsRepoLive, ConfigRepoTest({ projectsRoot: root }))
  const layer = Layer.provide(PidSettingsRepoLive, projectsLayer)
  return Effect.runPromise(Effect.provide(fx, layer))
}

describe("PidSettingsRepo readProject", () => {
  it("returns defaults when no settings file exists", async () => {
    const out = await withLayer(Effect.flatMap(PidSettingsService, (s) => s.readProject("demo")))
    expect(out).toEqual({ defaultSkills: ["goal"] })
  })

  it("reads an existing settings file", async () => {
    const out = await withLayer(Effect.flatMap(PidSettingsService, (s) => s.readProject("preset")))
    expect(out).toEqual({ defaultSkills: ["align", "tdd"] })
  })

  it("fails not_found for unknown projects", async () => {
    const res = await withLayer(
      Effect.flatMap(PidSettingsService, (s) => s.readProject("ghost")).pipe(Effect.either),
    )
    expect(res._tag === "Left" && res.left).toBe("not_found")
  })

  it("fails forbidden for unsafe ids", async () => {
    const res = await withLayer(
      Effect.flatMap(PidSettingsService, (s) => s.readProject("../etc")).pipe(Effect.either),
    )
    expect(res._tag === "Left" && res.left).toBe("forbidden")
  })
})

describe("PidSettingsRepo updateProject", () => {
  it("writes the settings file and round-trips on read", async () => {
    const written = await withLayer(
      Effect.flatMap(PidSettingsService, (s) =>
        s.updateProject("demo", { defaultSkills: ["concise"] }),
      ),
    )
    expect(written).toEqual({ defaultSkills: ["concise"] })

    const onDisk = await readFile(join(root, "demo", ".pid", "settings.json"), "utf8")
    expect(parsePidSettings(onDisk)).toEqual({ defaultSkills: ["concise"] })

    const reread = await withLayer(Effect.flatMap(PidSettingsService, (s) => s.readProject("demo")))
    expect(reread).toEqual({ defaultSkills: ["concise"] })
  })

  it("merges over existing settings rather than overwriting unknown intent", async () => {
    // An empty patch must preserve the prior selection.
    const out = await withLayer(
      Effect.flatMap(PidSettingsService, (s) => s.updateProject("preset", {})),
    )
    expect(out).toEqual({ defaultSkills: ["align", "tdd"] })
  })
})
