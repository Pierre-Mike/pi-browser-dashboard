import { describe, expect, test } from "bun:test"
import {
  DEFAULT_SPAWN_HARNESS,
  HARNESS_LABELS,
  HARNESS_SKILL_PREFIXES,
  normalizeHarness,
  SPAWN_HARNESSES,
} from "./spawnHarness"

describe("spawnHarness", () => {
  test("offers exactly the claude and pi harnesses, claude first and default", () => {
    expect(SPAWN_HARNESSES).toEqual(["claude", "pi"])
    expect(DEFAULT_SPAWN_HARNESS).toBe("claude")
  })

  test("claude skills prepend as /name, pi skills as /skill:name", () => {
    expect(HARNESS_SKILL_PREFIXES.claude).toBe("/")
    expect(HARNESS_SKILL_PREFIXES.pi).toBe("/skill:")
  })

  test("has a display label per harness", () => {
    expect(HARNESS_LABELS.claude).toBe("Claude")
    expect(HARNESS_LABELS.pi).toBe("pi")
  })

  test("normalizeHarness narrows arbitrary strings to a known harness", () => {
    expect(normalizeHarness("pi")).toBe("pi")
    expect(normalizeHarness("claude")).toBe("claude")
    expect(normalizeHarness("codex")).toBe("claude")
    expect(normalizeHarness("")).toBe("claude")
  })
})
