import { describe, expect, test } from "bun:test"
import { piModelValue } from "./usePiModels"

describe("piModelValue", () => {
  test("joins provider and id into pi's provider/id --model pattern", () => {
    expect(piModelValue({ provider: "anthropic", id: "claude-sonnet-5" })).toBe(
      "anthropic/claude-sonnet-5",
    )
    expect(piModelValue({ provider: "github-copilot", id: "gpt-5-mini" })).toBe(
      "github-copilot/gpt-5-mini",
    )
  })
})
