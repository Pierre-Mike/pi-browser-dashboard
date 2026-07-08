import { describe, expect, it } from "bun:test"
import { parseDispatchRequest } from "./dispatch.core"

describe("parseDispatchRequest", () => {
  it("rejects a missing or blank intent", () => {
    expect(parseDispatchRequest({})).toEqual({ ok: false, error: "missing_intent" })
    expect(parseDispatchRequest({ intent: "   " })).toEqual({ ok: false, error: "missing_intent" })
    expect(parseDispatchRequest({ intent: 42 })).toEqual({ ok: false, error: "missing_intent" })
  })

  it("defaults to the claude harness and forwards claude fields", () => {
    expect(
      parseDispatchRequest({
        intent: "go",
        cwd: "/repo",
        agent: "reviewer",
        permissionMode: "plan",
        effort: "high",
        model: "opus",
        tools: ["Bash"],
      }),
    ).toEqual({
      ok: true,
      harness: "claude",
      claude: {
        intent: "go",
        cwd: "/repo",
        agent: "reviewer",
        permissionMode: "plan",
        effort: "high",
        model: "opus",
        tools: ["Bash"],
      },
    })
  })

  it("parses a pi request into pi-shaped fields only", () => {
    expect(
      parseDispatchRequest({
        intent: "go",
        cwd: "/repo",
        harness: "pi",
        thinking: "high",
        model: "anthropic/claude-sonnet-5",
        tools: ["read"],
        agent: "ignored-for-pi",
      }),
    ).toEqual({
      ok: true,
      harness: "pi",
      pi: {
        intent: "go",
        cwd: "/repo",
        thinking: "high",
        model: "anthropic/claude-sonnet-5",
        tools: ["read"],
      },
    })
  })

  it("rejects an unknown harness instead of silently spawning claude", () => {
    expect(parseDispatchRequest({ intent: "go", harness: "codex" })).toEqual({
      ok: false,
      error: "invalid_harness",
    })
    expect(parseDispatchRequest({ intent: "go", harness: 42 })).toEqual({
      ok: false,
      error: "invalid_harness",
    })
  })

  it("treats malformed optional fields as absent", () => {
    const parsed = parseDispatchRequest({ intent: "go", cwd: 1, tools: ["Bash", 42] })
    expect(parsed).toEqual({
      ok: true,
      harness: "claude",
      claude: {
        intent: "go",
        cwd: undefined,
        agent: undefined,
        permissionMode: undefined,
        effort: undefined,
        model: undefined,
        tools: undefined,
      },
    })
  })
})
