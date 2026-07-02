import { describe, expect, it } from "bun:test"
import { buildSpawnCommandArgs, formatSpawnCommand } from "./spawnCommandArgs"

describe("buildSpawnCommandArgs", () => {
  it("builds the bare `claude --bg <intent>` argv with no effort or tools", () => {
    expect(buildSpawnCommandArgs({ intent: "fix bug" })).toEqual(["claude", "--bg", "fix bug"])
  })

  it("inserts --effort before the intent when an effort level is set", () => {
    expect(buildSpawnCommandArgs({ intent: "fix bug", effort: "high" })).toEqual([
      "claude",
      "--bg",
      "--effort",
      "high",
      "fix bug",
    ])
  })

  it("omits --effort for the empty inherit default", () => {
    expect(buildSpawnCommandArgs({ intent: "fix bug", effort: "" })).toEqual([
      "claude",
      "--bg",
      "fix bug",
    ])
  })

  it("omits --tools when tools is undefined (every tool, the CLI default)", () => {
    expect(buildSpawnCommandArgs({ intent: "fix bug", tools: undefined })).toEqual([
      "claude",
      "--bg",
      "fix bug",
    ])
  })

  it("adds a `--` terminator after an explicit tools list so it can't swallow the intent", () => {
    expect(buildSpawnCommandArgs({ intent: "fix bug", tools: ["Bash", "Edit"] })).toEqual([
      "claude",
      "--bg",
      "--tools",
      "Bash,Edit",
      "--",
      "fix bug",
    ])
  })

  it("passes an explicit empty tools list through as --tools ''", () => {
    expect(buildSpawnCommandArgs({ intent: "fix bug", tools: [] })).toEqual([
      "claude",
      "--bg",
      "--tools",
      "",
      "--",
      "fix bug",
    ])
  })

  it("inserts --model before the intent when a model alias is set", () => {
    expect(buildSpawnCommandArgs({ intent: "fix bug", model: "opus" })).toEqual([
      "claude",
      "--bg",
      "--model",
      "opus",
      "fix bug",
    ])
  })

  it("omits --model for the empty inherit default", () => {
    expect(buildSpawnCommandArgs({ intent: "fix bug", model: "" })).toEqual([
      "claude",
      "--bg",
      "fix bug",
    ])
  })

  it("orders --model after --effort, matching the daemon's buildDispatchArgs", () => {
    expect(buildSpawnCommandArgs({ intent: "fix bug", effort: "max", model: "opus" })).toEqual([
      "claude",
      "--bg",
      "--effort",
      "max",
      "--model",
      "opus",
      "fix bug",
    ])
  })

  it("orders --effort before --tools, matching the daemon's buildDispatchArgs", () => {
    expect(buildSpawnCommandArgs({ intent: "fix bug", effort: "max", tools: ["Read"] })).toEqual([
      "claude",
      "--bg",
      "--effort",
      "max",
      "--tools",
      "Read",
      "--",
      "fix bug",
    ])
  })
})

describe("formatSpawnCommand", () => {
  it("joins simple argv entries with spaces, unquoted", () => {
    expect(formatSpawnCommand(["claude", "--bg", "--effort", "high", "go"])).toBe(
      "claude --bg --effort high go",
    )
  })

  it("single-quotes an argument containing whitespace", () => {
    expect(formatSpawnCommand(["claude", "--bg", "fix the login bug"])).toBe(
      "claude --bg 'fix the login bug'",
    )
  })

  it("single-quotes an empty argument so it stays visible", () => {
    expect(formatSpawnCommand(["claude", "--bg", "--tools", "", "--", "go"])).toBe(
      "claude --bg --tools '' -- go",
    )
  })

  it("escapes an embedded single quote", () => {
    expect(formatSpawnCommand(["claude", "--bg", "it's broken"])).toBe(
      "claude --bg 'it'\\''s broken'",
    )
  })

  it("leaves a slash-prefixed skill command unquoted when it has no spaces", () => {
    expect(formatSpawnCommand(["claude", "--bg", "/tdd"])).toBe("claude --bg /tdd")
  })
})
