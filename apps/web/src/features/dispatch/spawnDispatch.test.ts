import { describe, expect, it } from "bun:test"
import { buildDispatchBody } from "./spawnDispatch"

const project = { id: "p1", name: "proj", path: "/repo" }

describe("buildDispatchBody (claude)", () => {
  it("sends just the intent for a bare spawn", () => {
    expect(buildDispatchBody({ intent: "go", project: null })).toEqual({ intent: "go" })
  })

  it("scopes to the project cwd and forwards normalized effort/model", () => {
    expect(buildDispatchBody({ intent: "go", project, effort: "high", model: "opus" })).toEqual({
      intent: "go",
      cwd: "/repo",
      effort: "high",
      model: "opus",
    })
  })

  it("drops unrecognized effort/model values instead of forwarding them", () => {
    expect(
      buildDispatchBody({ intent: "go", project: null, effort: "warp", model: "gpt" }),
    ).toEqual({ intent: "go" })
  })

  it("passes an explicit tools list through, including empty", () => {
    expect(buildDispatchBody({ intent: "go", project: null, tools: [] })).toEqual({
      intent: "go",
      tools: [],
    })
  })

  it("omits the harness field for claude so the request body stays unchanged", () => {
    expect(
      buildDispatchBody({ intent: "go", project: null, harness: "claude" }),
    ).not.toHaveProperty("harness")
  })
})

describe("buildDispatchBody (pi)", () => {
  it("tags the harness and forwards thinking/model/tools in pi shape", () => {
    expect(
      buildDispatchBody({
        intent: "go",
        project,
        harness: "pi",
        thinking: "high",
        model: "anthropic/claude-sonnet-5",
        tools: ["read", "bash"],
      }),
    ).toEqual({
      intent: "go",
      cwd: "/repo",
      harness: "pi",
      thinking: "high",
      model: "anthropic/claude-sonnet-5",
      tools: ["read", "bash"],
    })
  })

  it("drops an invalid thinking level and the empty inherit model", () => {
    expect(
      buildDispatchBody({ intent: "go", project: null, harness: "pi", thinking: "max", model: "" }),
    ).toEqual({ intent: "go", harness: "pi" })
  })

  it("never forwards claude-only effort on a pi dispatch", () => {
    expect(
      buildDispatchBody({ intent: "go", project: null, harness: "pi", effort: "high" }),
    ).not.toHaveProperty("effort")
  })
})
