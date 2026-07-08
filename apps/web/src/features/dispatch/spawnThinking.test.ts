import { describe, expect, test } from "bun:test"
import { DEFAULT_SPAWN_THINKING, normalizeThinking, PI_THINKING_LEVELS } from "./spawnThinking"

describe("spawnThinking", () => {
  test("offers pi's documented thinking levels in ascending order", () => {
    expect(PI_THINKING_LEVELS).toEqual(["off", "minimal", "low", "medium", "high", "xhigh"])
  })

  test("defaults to inherit (empty string, no --thinking flag)", () => {
    expect(DEFAULT_SPAWN_THINKING).toBe("")
  })

  test("normalizeThinking narrows valid levels and drops everything else", () => {
    expect(normalizeThinking("high")).toBe("high")
    expect(normalizeThinking("off")).toBe("off")
    expect(normalizeThinking("")).toBeUndefined()
    expect(normalizeThinking("max")).toBeUndefined()
  })
})
