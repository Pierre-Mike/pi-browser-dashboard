import { describe, expect, it } from "bun:test"
import { resolveSpawnCwd } from "./shell.repo"

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
