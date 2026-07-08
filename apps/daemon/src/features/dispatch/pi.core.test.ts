import { describe, expect, it } from "bun:test"
import { buildPiDispatchArgs, parsePiModels } from "./pi.core"

const SAMPLE = [
  "provider        model                                context  max-out  thinking  images",
  "anthropic       claude-fable-5                       1M       128K     yes       yes   ",
  "anthropic       claude-sonnet-5                      1M       128K     yes       yes   ",
  "github-copilot  gpt-5-mini                           264K     64K      yes       yes   ",
  "",
].join("\n")

describe("parsePiModels", () => {
  it("parses provider + model id per row, skipping the header", () => {
    expect(parsePiModels(SAMPLE)).toEqual([
      { provider: "anthropic", id: "claude-fable-5" },
      { provider: "anthropic", id: "claude-sonnet-5" },
      { provider: "github-copilot", id: "gpt-5-mini" },
    ])
  })

  it("returns an empty list for empty output", () => {
    expect(parsePiModels("")).toEqual([])
    expect(parsePiModels("\n\n")).toEqual([])
  })

  it("drops malformed rows rather than inventing entries", () => {
    const out = parsePiModels(`${SAMPLE}\nlonelytoken\n`)
    expect(out).toHaveLength(3)
  })

  it("strips ANSI styling so a tty-colored table still parses", () => {
    const styled = [
      "\x1b[1mprovider\x1b[22m        model      context",
      "\x1b[1manthropic\x1b[22m       claude-sonnet-5   1M",
    ].join("\n")
    expect(parsePiModels(styled)).toEqual([{ provider: "anthropic", id: "claude-sonnet-5" }])
  })
})

describe("buildPiDispatchArgs", () => {
  it("builds a bare non-interactive run from just an intent", () => {
    expect(buildPiDispatchArgs({ intent: "fix the bug" })).toEqual(["pi", "-p", "fix the bug"])
  })

  it("carries session id, thinking level, model, and tool allow-list as pi flags", () => {
    expect(
      buildPiDispatchArgs({
        intent: "go",
        sessionId: "0f9e8d7c",
        thinking: "high",
        model: "anthropic/claude-sonnet-5",
        tools: ["read", "bash"],
      }),
    ).toEqual([
      "pi",
      "--session-id",
      "0f9e8d7c",
      "--thinking",
      "high",
      "--model",
      "anthropic/claude-sonnet-5",
      "--tools",
      "read,bash",
      "-p",
      "go",
    ])
  })

  it("maps an explicit empty tool list to --no-tools (disable everything)", () => {
    expect(buildPiDispatchArgs({ intent: "go", tools: [] })).toEqual([
      "pi",
      "--no-tools",
      "-p",
      "go",
    ])
  })

  it("omits the tools flag entirely when tools is undefined (pi default: all)", () => {
    expect(buildPiDispatchArgs({ intent: "go", tools: undefined })).toEqual(["pi", "-p", "go"])
  })
})
