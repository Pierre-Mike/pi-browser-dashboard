import { describe, expect, test } from "bun:test"
import { DEFAULT_SPAWN_MODEL, normalizeModel, SPAWN_MODEL_ALIASES } from "./spawnModel"

describe("spawnModel", () => {
  test("exposes the CLI's model aliases", () => {
    expect(SPAWN_MODEL_ALIASES).toEqual(["opus", "sonnet", "haiku", "fable"])
  })

  test("default is the inherit sentinel (empty string)", () => {
    expect(DEFAULT_SPAWN_MODEL).toBe("")
  })

  test("normalizeModel keeps a valid alias", () => {
    expect(normalizeModel("opus")).toBe("opus")
  })

  test("normalizeModel drops the inherit default to undefined", () => {
    expect(normalizeModel(DEFAULT_SPAWN_MODEL)).toBeUndefined()
  })

  test("normalizeModel drops an unrecognised value to undefined", () => {
    expect(normalizeModel("claude-opus-4-8")).toBeUndefined()
  })
})
