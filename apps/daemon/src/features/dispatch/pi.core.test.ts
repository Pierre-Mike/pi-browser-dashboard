import { describe, expect, it } from "bun:test"
import {
  buildPiLauncherScript,
  buildPiRunArgv,
  parsePiModels,
  piBackgroundSessionArgv,
  piLaunchFailureMessage,
  piLaunchVerdict,
} from "./pi.core"

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

describe("buildPiRunArgv", () => {
  it("builds a bare INTERACTIVE run (intent as a trailing positional, no -p)", () => {
    // Interactive — no `-p` — so pi processes the intent then stays in the TUI,
    // which is what makes the zellij session attachable.
    expect(buildPiRunArgv({ intent: "fix the bug" })).toEqual(["pi", "fix the bug"])
  })

  it("carries session id, thinking level, model, and tool allow-list as pi flags", () => {
    expect(
      buildPiRunArgv({
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
      "go",
    ])
  })

  it("keeps the intent last so pi never swallows it as a flag value", () => {
    const argv = buildPiRunArgv({ intent: "the intent", tools: ["read"] })
    expect(argv[argv.length - 1]).toBe("the intent")
  })

  it("maps an explicit empty tool list to --no-tools (disable everything)", () => {
    expect(buildPiRunArgv({ intent: "go", tools: [] })).toEqual(["pi", "--no-tools", "go"])
  })

  it("omits the tools flag entirely when tools is undefined (pi default: all)", () => {
    expect(buildPiRunArgv({ intent: "go", tools: undefined })).toEqual(["pi", "go"])
  })
})

describe("buildPiLauncherScript", () => {
  it("records $$ before exec so the recorded pid IS pi's, and redirects stderr", () => {
    // `echo $$` writes bash's pid; `exec` replaces bash with pi, which inherits
    // that pid. So the pid the daemon reads is pi's own — the liveness signal.
    const script = buildPiLauncherScript({
      runArgv: ["pi", "--session-id", "abc", "go"],
      pidPath: "/t/pid",
      stderrPath: "/t/err",
    })
    expect(script).toBe("echo $$ > '/t/pid'\nexec 'pi' '--session-id' 'abc' 'go' 2> '/t/err'\n")
  })

  it("single-quote-escapes an intent with shell metacharacters so it stays ONE arg", () => {
    // The intent is arbitrary user text; without quoting a `;` or `$(…)` would
    // run as a shell command. shq wraps every argv slot in single quotes.
    const script = buildPiLauncherScript({
      runArgv: ["pi", "rm -rf / ; echo $(whoami)"],
      pidPath: "/t/pid",
      stderrPath: "/t/err",
    })
    expect(script).toContain("exec 'pi' 'rm -rf / ; echo $(whoami)' 2> '/t/err'")
  })

  it("escapes an embedded single quote in the intent (POSIX '\\'' trick)", () => {
    const script = buildPiLauncherScript({
      runArgv: ["pi", "it's fine"],
      pidPath: "/t/pid",
      stderrPath: "/t/err",
    })
    expect(script).toContain(`'it'\\''s fine'`)
  })
})

describe("piBackgroundSessionArgv", () => {
  it("puts -n <layout> before the attach subcommand and -b for a detached session", () => {
    expect(
      piBackgroundSessionArgv({ layoutPath: "/t/layout.kdl", sessionName: "pi-abcd1234" }),
    ).toEqual(["zellij", "-n", "/t/layout.kdl", "attach", "-b", "pi-abcd1234"])
  })
})

describe("piLaunchVerdict", () => {
  it("succeeds with the parsed pid when the launcher wrote a live pid", () => {
    expect(piLaunchVerdict({ pidRaw: "4321\n", pidAlive: true, stderr: "" })).toEqual({
      ok: true,
      pid: 4321,
    })
  })

  it("fails with pi's stderr when the pid is dead (e.g. unkeyed model)", () => {
    expect(
      piLaunchVerdict({
        pidRaw: "4321",
        pidAlive: false,
        stderr: "No API key for provider: anthropic\n",
      }),
    ).toEqual({ ok: false, message: "No API key for provider: anthropic" })
  })

  it("fails with a generic message when the pid is gone and stderr is empty", () => {
    expect(piLaunchVerdict({ pidRaw: "4321", pidAlive: false, stderr: "  \n" })).toEqual({
      ok: false,
      message: "pi exited before starting",
    })
  })

  it("fails when the launcher never wrote a pid at all", () => {
    expect(piLaunchVerdict({ pidRaw: undefined, pidAlive: false, stderr: "boom" })).toEqual({
      ok: false,
      message: "boom",
    })
  })
})

describe("piLaunchFailureMessage", () => {
  it("surfaces pi's own stderr, trimmed, as the failure message", () => {
    expect(piLaunchFailureMessage(1, "No API key for provider: anthropic\n")).toBe(
      "No API key for provider: anthropic",
    )
  })

  it("falls back to the exit code when pi died without writing stderr", () => {
    expect(piLaunchFailureMessage(7, "")).toBe("pi exited with code 7 before starting")
    expect(piLaunchFailureMessage(1, "   \n")).toBe("pi exited with code 1 before starting")
  })
})
