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

  it("passes --model before the intent when a model alias is given", () => {
    expect(buildDispatchArgs({ intent: "do it", model: "opus" })).toEqual([
      "claude",
      "--bg",
      "--model",
      "opus",
      "do it",
    ])
  })

  it("omits --model when none is given", () => {
    expect(buildDispatchArgs({ intent: "do it" })).not.toContain("--model")
  })

  it("places --model after --effort", () => {
    expect(buildDispatchArgs({ intent: "go", effort: "max", model: "opus" })).toEqual([
      "claude",
      "--bg",
      "--effort",
      "max",
      "--model",
      "opus",
      "go",
    ])
  })

  it("omits --tools when no tool list is given", () => {
    expect(buildDispatchArgs({ intent: "do it" })).not.toContain("--tools")
  })

  it("joins a tool list into --tools, terminated with -- before the intent", () => {
    // `--tools <tools...>` is variadic — without a `--` terminator it swallows
    // a trailing positional intent as more "tool names" instead of the prompt.
    expect(buildDispatchArgs({ intent: "go", tools: ["Bash", "Edit"] })).toEqual([
      "claude",
      "--bg",
      "--tools",
      "Bash,Edit",
      "--",
      "go",
    ])
  })

  it('passes --tools "" (and the -- terminator) for an explicit empty tool list', () => {
    expect(buildDispatchArgs({ intent: "go", tools: [] })).toEqual([
      "claude",
      "--bg",
      "--tools",
      "",
      "--",
      "go",
    ])
  })

  it("places --tools and its -- terminator after the other flags", () => {
    expect(
      buildDispatchArgs({ intent: "go", agent: "reviewer", effort: "max", tools: ["Read"] }),
    ).toEqual([
      "claude",
      "--bg",
      "--agent",
      "reviewer",
      "--effort",
      "max",
      "--tools",
      "Read",
      "--",
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
