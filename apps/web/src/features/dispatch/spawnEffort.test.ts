import { describe, expect, test } from "bun:test"
import { DEFAULT_SPAWN_EFFORT, normalizeEffort, SPAWN_EFFORT_LEVELS } from "./spawnEffort"

describe("spawnEffort", () => {
  test("exposes the five CLI effort levels in ascending order", () => {
    expect(SPAWN_EFFORT_LEVELS).toEqual(["low", "medium", "high", "xhigh", "max"])
  })

  test("default is the inherit sentinel (empty string)", () => {
    expect(DEFAULT_SPAWN_EFFORT).toBe("")
  })

  test("normalizeEffort keeps a valid level", () => {
    expect(normalizeEffort("high")).toBe("high")
  })

  test("normalizeEffort drops the inherit default to undefined", () => {
    expect(normalizeEffort(DEFAULT_SPAWN_EFFORT)).toBeUndefined()
  })

  test("normalizeEffort drops an unrecognised value to undefined", () => {
    expect(normalizeEffort("turbo")).toBeUndefined()
  })
})
