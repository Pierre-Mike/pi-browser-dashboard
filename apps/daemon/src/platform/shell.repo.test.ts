import { describe, expect, it } from "bun:test"
import { buildDispatchArgs, resolveSpawnCwd } from "./shell.repo"

describe("buildDispatchArgs", () => {
  it("builds a bare background dispatch with just the intent", () => {
    expect(buildDispatchArgs({ intent: "do it" })).toEqual(["claude", "--bg", "do it"])
  })

  it("passes --effort before the intent when an effort level is given", () => {
    expect(buildDispatchArgs({ intent: "do it", effort: "high" })).toEqual([
      "claude",
      "--bg",
      "--effort",
      "high",
      "do it",
    ])
  })

  it("omits --effort when no level is given", () => {
    expect(buildDispatchArgs({ intent: "do it" })).not.toContain("--effort")
  })

  it("combines agent, permission mode and effort flags", () => {
    expect(
      buildDispatchArgs({
        intent: "go",
        agent: "reviewer",
        permissionMode: "default",
        effort: "max",
      }),
    ).toEqual([
      "claude",
      "--bg",
      "--agent",
      "reviewer",
      "--permission-mode",
      "default",
      "--effort",
      "max",
      "go",
    ])
  })
})

describe("resolveSpawnCwd", () => {
  it("keeps an explicit cwd when one is given", () => {
    expect(resolveSpawnCwd("/repo", { HOME: "/home/me" })).toBe("/repo")
  })

  it("defaults to HOME when no cwd is given so default sessions start in ~", () => {
    expect(resolveSpawnCwd(undefined, { HOME: "/home/me" })).toBe("/home/me")
  })

  it("treats an empty cwd as absent and falls back to HOME", () => {
    expect(resolveSpawnCwd("", { HOME: "/home/me" })).toBe("/home/me")
  })

  it("falls back to '/' when neither cwd nor HOME is present — Bun.spawn rejects an empty cwd", () => {
    expect(resolveSpawnCwd(undefined, {})).toBe("/")
  })
})
