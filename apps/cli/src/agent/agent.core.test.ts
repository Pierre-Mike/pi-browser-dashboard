import { describe, expect, it } from "bun:test"
import { Either } from "effect"
import {
  buildDispatchRequestBody,
  buildFleetRunRequestBody,
  buildKeysRequestBody,
  buildSendRequestBody,
  buildWaitRequestBody,
  DEFAULT_PID_URL,
  errorMessageFrom,
  exitCodeForFleetRunStatus,
  exitCodeForFleets,
  exitCodeForOutcome,
  exitCodeForRulesErrors,
  exitCodeForTerminalLookup,
  exitCodeForUsage,
  exitCodeForWaitBody,
  filterByState,
  filterTerminalsByKey,
  formatExplain,
  formatFleetDryRun,
  formatFleetRunStarted,
  formatFleetRunSummary,
  formatFleetRuns,
  formatFleets,
  formatKeysSent,
  formatRemoved,
  formatRulesPreview,
  formatRulesStatus,
  formatSent,
  formatSessions,
  formatSpawned,
  formatStopped,
  formatTerminalStates,
  formatWaitOutcome,
  isNamedKeyName,
  isSessionStateSlug,
  isTerminalStateSlug,
  parseAgentArgv,
  parseDispatchResponse,
  parseExplainResponse,
  parseFleetDryRunResponse,
  parseFleetRunStarted,
  parseFleetRunSummary,
  parseFleetRunsResponse,
  parseFleetsResponse,
  parseKeysResponse,
  parseOkShortResponse,
  parseRulesPreviewResponse,
  parseRulesStatusResponse,
  parseSendResponse,
  parseSessionsResponse,
  parseTerminalStatesResponse,
  parseWaitOutcomeBody,
  resolveApiBase,
  resolveBaseUrl,
  worstExitCode,
} from "./agent.core"

const right = <T>(command: Either.Either<T, unknown>): T => {
  if (Either.isLeft(command))
    throw new Error(`expected Right, got Left: ${JSON.stringify(command.left)}`)
  return command.right
}

const left = <E>(command: Either.Either<unknown, E>): E => {
  if (Either.isRight(command))
    throw new Error(`expected Left, got Right: ${JSON.stringify(command.right)}`)
  return command.left
}

describe("isSessionStateSlug / isNamedKeyName", () => {
  it("accepts every known slug and rejects anything else", () => {
    expect(isSessionStateSlug("done")).toBe(true)
    expect(isSessionStateSlug("working")).toBe(true)
    expect(isSessionStateSlug("blocked")).toBe(true)
    expect(isSessionStateSlug("needs_input")).toBe(true)
    expect(isSessionStateSlug("idle")).toBe(true)
    expect(isSessionStateSlug("failed")).toBe(true)
    expect(isSessionStateSlug("stopped")).toBe(true)
    expect(isSessionStateSlug("unknown")).toBe(true)
    expect(isSessionStateSlug("nope")).toBe(false)
  })

  it("accepts every named key and rejects anything else", () => {
    expect(isNamedKeyName("escape")).toBe(true)
    expect(isNamedKeyName("shift-tab")).toBe(true)
    expect(isNamedKeyName("page-down")).toBe(true)
    expect(isNamedKeyName("ctrl-c")).toBe(false)
    expect(isNamedKeyName("ctrl-z")).toBe(false)
  })
})

describe("parseAgentArgv", () => {
  it("resolves an empty invocation to Help", () => {
    expect(right(parseAgentArgv([]))).toEqual({ _tag: "Help", url: undefined })
  })

  it("resolves --help / -h anywhere to Help, ignoring everything else", () => {
    expect(right(parseAgentArgv(["--help"]))).toEqual({ _tag: "Help", url: undefined })
    expect(right(parseAgentArgv(["-h"]))).toEqual({ _tag: "Help", url: undefined })
    expect(right(parseAgentArgv(["sessions", "--help"]))).toEqual({ _tag: "Help", url: undefined })
    expect(right(parseAgentArgv(["explain", "ab12", "-h"]))).toEqual({
      _tag: "Help",
      url: undefined,
    })
  })

  it("extracts --url regardless of position and carries it through", () => {
    expect(right(parseAgentArgv(["--url", "http://h:1", "sessions"]))).toEqual({
      _tag: "Sessions",
      state: undefined,
      json: false,
      url: "http://h:1",
    })
    expect(right(parseAgentArgv(["sessions", "--url", "http://h:1"]))).toEqual({
      _tag: "Sessions",
      state: undefined,
      json: false,
      url: "http://h:1",
    })
    expect(right(parseAgentArgv(["sessions", "--url=http://h:2"]))).toEqual({
      _tag: "Sessions",
      state: undefined,
      json: false,
      url: "http://h:2",
    })
  })

  it("rejects an unknown command as a usage error", () => {
    expect(left(parseAgentArgv(["frobnicate"])).message).toBe("unknown command: frobnicate")
  })

  describe("sessions", () => {
    it("defaults to no state filter, json off", () => {
      expect(right(parseAgentArgv(["sessions"]))).toEqual({
        _tag: "Sessions",
        state: undefined,
        json: false,
        url: undefined,
      })
    })

    it("parses --state as a comma list and dedupes, plus --json", () => {
      expect(right(parseAgentArgv(["sessions", "--state", "done,failed,done", "--json"]))).toEqual({
        _tag: "Sessions",
        state: ["done", "failed"],
        json: true,
        url: undefined,
      })
    })

    it("parses --state=<list> form", () => {
      expect(right(parseAgentArgv(["sessions", "--state=idle"]))).toEqual({
        _tag: "Sessions",
        state: ["idle"],
        json: false,
        url: undefined,
      })
    })

    it("rejects an unknown state slug", () => {
      expect(left(parseAgentArgv(["sessions", "--state", "bogus"])).message).toBe(
        'sessions: --state contains an unknown state: "bogus"',
      )
    })

    it("rejects an empty --state list", () => {
      expect(left(parseAgentArgv(["sessions", "--state", ",, "])).message).toBe(
        "sessions: --state must list at least one session state",
      )
    })

    it("rejects unexpected positional arguments", () => {
      expect(left(parseAgentArgv(["sessions", "extra"])).message).toBe(
        "sessions: unexpected argument: extra",
      )
      expect(left(parseAgentArgv(["sessions", "a", "b"])).message).toBe(
        "sessions: unexpected arguments: a b",
      )
    })

    it("rejects an unknown flag", () => {
      expect(left(parseAgentArgv(["sessions", "--bogus"])).message).toBe(
        "sessions: unknown flag --bogus",
      )
    })

    it("rejects a valued flag missing its value", () => {
      expect(left(parseAgentArgv(["sessions", "--state"])).message).toBe(
        "sessions: --state requires a value",
      )
      expect(left(parseAgentArgv(["sessions", "--state", "--json"])).message).toBe(
        "sessions: --state requires a value",
      )
    })

    it("rejects a boolean flag given a value", () => {
      expect(left(parseAgentArgv(["sessions", "--json=1"])).message).toBe(
        "sessions: --json does not take a value",
      )
    })
  })

  describe("explain", () => {
    it("requires a <short>", () => {
      expect(left(parseAgentArgv(["explain"])).message).toBe("explain: requires a <short> argument")
    })

    it("parses <short> and --json", () => {
      expect(right(parseAgentArgv(["explain", "ab12", "--json"]))).toEqual({
        _tag: "Explain",
        short: "ab12",
        json: true,
        url: undefined,
      })
    })

    it("rejects extra positional arguments", () => {
      expect(left(parseAgentArgv(["explain", "ab12", "cd34"])).message).toBe(
        "explain: unexpected argument: cd34",
      )
    })
  })

  describe("wait", () => {
    it("requires a <short>", () => {
      expect(left(parseAgentArgv(["wait", "--until", "done"])).message).toBe(
        "wait: requires a <short> argument",
      )
    })

    it("requires --until", () => {
      expect(left(parseAgentArgv(["wait", "ab12"])).message).toBe("wait: --until is required")
    })

    it("parses <short> --until <list> [--timeout] [--json]", () => {
      expect(
        right(
          parseAgentArgv(["wait", "ab12", "--until", "done,failed", "--timeout", "2000", "--json"]),
        ),
      ).toEqual({
        _tag: "Wait",
        short: "ab12",
        until: ["done", "failed"],
        timeoutMs: 2000,
        json: true,
        url: undefined,
      })
    })

    it("defaults timeoutMs to undefined when --timeout is absent", () => {
      expect(right(parseAgentArgv(["wait", "ab12", "--until", "done"]))).toEqual({
        _tag: "Wait",
        short: "ab12",
        until: ["done"],
        timeoutMs: undefined,
        json: false,
        url: undefined,
      })
    })

    it("rejects a bad --until slug", () => {
      expect(left(parseAgentArgv(["wait", "ab12", "--until", "bogus"])).message).toBe(
        'wait: --until contains an unknown state: "bogus"',
      )
    })

    it("rejects a non-integer --timeout", () => {
      expect(
        left(parseAgentArgv(["wait", "ab12", "--until", "done", "--timeout", "soon"])).message,
      ).toBe('wait: --timeout must be a positive integer, got "soon"')
    })

    it("rejects a zero or negative --timeout", () => {
      expect(
        left(parseAgentArgv(["wait", "ab12", "--until", "done", "--timeout", "0"])).message,
      ).toBe('wait: --timeout must be a positive integer, got "0"')
    })

    it("rejects extra positional arguments", () => {
      expect(left(parseAgentArgv(["wait", "ab12", "cd34", "--until", "done"])).message).toBe(
        "wait: unexpected argument: cd34",
      )
    })
  })

  describe("send", () => {
    it("requires <short> and <text...>", () => {
      expect(left(parseAgentArgv(["send"])).message).toBe("send: requires <short> and <text...>")
      expect(left(parseAgentArgv(["send", "ab12"])).message).toBe(
        "send: requires <short> and <text...>",
      )
    })

    it("joins multi-word positional text with a single space", () => {
      expect(right(parseAgentArgv(["send", "ab12", "next", "step"]))).toEqual({
        _tag: "Send",
        short: "ab12",
        text: "next step",
        wait: undefined,
        json: false,
        url: undefined,
      })
    })

    it("parses --wait and --timeout into a WaitParams", () => {
      expect(
        right(parseAgentArgv(["send", "ab12", "go", "--wait", "done,idle", "--timeout", "5000"])),
      ).toEqual({
        _tag: "Send",
        short: "ab12",
        text: "go",
        wait: { until: ["done", "idle"], timeoutMs: 5000 },
        json: false,
        url: undefined,
      })
    })

    it("rejects a bad --wait slug", () => {
      expect(left(parseAgentArgv(["send", "ab12", "go", "--wait", "bogus"])).message).toBe(
        'send: --wait contains an unknown state: "bogus"',
      )
    })
  })

  describe("keys", () => {
    it("requires <short> and at least one <name>", () => {
      expect(left(parseAgentArgv(["keys"])).message).toBe(
        "keys: requires <short> and one or more <name>",
      )
      expect(left(parseAgentArgv(["keys", "ab12"])).message).toBe(
        "keys: requires <short> and one or more <name>",
      )
    })

    it("parses repeated names in order", () => {
      expect(right(parseAgentArgv(["keys", "ab12", "down", "down", "enter"]))).toEqual({
        _tag: "Keys",
        short: "ab12",
        names: ["down", "down", "enter"],
        wait: undefined,
        json: false,
        url: undefined,
      })
    })

    it("rejects an unknown key name", () => {
      const message = left(parseAgentArgv(["keys", "ab12", "ctrl-c"])).message
      expect(message.startsWith('keys: unknown key name "ctrl-c" — expected one of:')).toBe(true)
    })

    it("parses --wait for keys too", () => {
      expect(right(parseAgentArgv(["keys", "ab12", "enter", "--wait", "working"]))).toEqual({
        _tag: "Keys",
        short: "ab12",
        names: ["enter"],
        wait: { until: ["working"], timeoutMs: undefined },
        json: false,
        url: undefined,
      })
    })
  })

  describe("spawn", () => {
    it("requires an <intent>", () => {
      expect(left(parseAgentArgv(["spawn"])).message).toBe("spawn: requires an <intent> argument")
    })

    it("joins multi-word intent and defaults n to 1", () => {
      expect(right(parseAgentArgv(["spawn", "fix", "the", "bug"]))).toEqual({
        _tag: "Spawn",
        intent: "fix the bug",
        n: 1,
        agent: undefined,
        cwd: undefined,
        wait: undefined,
        json: false,
        url: undefined,
      })
    })

    it("parses --n, --agent, --cwd, --wait, --json", () => {
      expect(
        right(
          parseAgentArgv([
            "spawn",
            "do",
            "it",
            "--n",
            "3",
            "--agent",
            "reviewer",
            "--cwd",
            "/tmp/x",
            "--wait",
            "done",
            "--json",
          ]),
        ),
      ).toEqual({
        _tag: "Spawn",
        intent: "do it",
        n: 3,
        agent: "reviewer",
        cwd: "/tmp/x",
        wait: { until: ["done"], timeoutMs: undefined },
        json: true,
        url: undefined,
      })
    })

    it("rejects a non-positive-integer --n", () => {
      expect(left(parseAgentArgv(["spawn", "go", "--n", "0"])).message).toBe(
        'spawn: --n must be a positive integer, got "0"',
      )
      expect(left(parseAgentArgv(["spawn", "go", "--n", "abc"])).message).toBe(
        'spawn: --n must be a positive integer, got "abc"',
      )
    })
  })

  describe("stop / rm", () => {
    it("requires a <short>", () => {
      expect(left(parseAgentArgv(["stop"])).message).toBe("stop: requires a <short> argument")
      expect(left(parseAgentArgv(["rm"])).message).toBe("rm: requires a <short> argument")
    })

    it("parses <short>", () => {
      expect(right(parseAgentArgv(["stop", "ab12"]))).toEqual({
        _tag: "Stop",
        short: "ab12",
        json: false,
        url: undefined,
      })
      expect(right(parseAgentArgv(["rm", "ab12", "--json"]))).toEqual({
        _tag: "Rm",
        short: "ab12",
        json: true,
        url: undefined,
      })
    })

    it("rejects extra positional arguments", () => {
      expect(left(parseAgentArgv(["stop", "ab12", "cd34"])).message).toBe(
        "stop: unexpected argument: cd34",
      )
    })
  })

  describe("fleets", () => {
    it("defaults project to undefined (resolved by the shell) and json to false", () => {
      expect(right(parseAgentArgv(["fleets"]))).toEqual({
        _tag: "Fleets",
        project: undefined,
        json: false,
        url: undefined,
      })
    })

    it("parses --project and --json", () => {
      expect(right(parseAgentArgv(["fleets", "--project", "demo", "--json"]))).toEqual({
        _tag: "Fleets",
        project: "demo",
        json: true,
        url: undefined,
      })
    })

    it("rejects a positional argument", () => {
      expect(left(parseAgentArgv(["fleets", "extra"])).message).toBe(
        "fleets: unexpected argument: extra",
      )
    })
  })

  describe("fleet run / fleet runs", () => {
    it("parses fleet run <name> with defaults", () => {
      expect(right(parseAgentArgv(["fleet", "run", "review-and-fix"]))).toEqual({
        _tag: "FleetRun",
        name: "review-and-fix",
        project: undefined,
        dryRun: false,
        wait: false,
        json: false,
        url: undefined,
      })
    })

    it("parses --project, --dry-run, --wait and --json together", () => {
      expect(
        right(
          parseAgentArgv([
            "fleet",
            "run",
            "review-and-fix",
            "--project",
            "demo",
            "--dry-run",
            "--wait",
            "--json",
          ]),
        ),
      ).toEqual({
        _tag: "FleetRun",
        name: "review-and-fix",
        project: "demo",
        dryRun: true,
        wait: true,
        json: true,
        url: undefined,
      })
    })

    it("requires a <name> argument", () => {
      expect(left(parseAgentArgv(["fleet", "run"])).message).toBe(
        "fleet run: requires a <name> argument",
      )
    })

    it("rejects an extra positional argument", () => {
      expect(left(parseAgentArgv(["fleet", "run", "a", "b"])).message).toBe(
        "fleet run: unexpected argument: b",
      )
    })

    it("parses fleet runs with defaults and with --project/--json", () => {
      expect(right(parseAgentArgv(["fleet", "runs"]))).toEqual({
        _tag: "FleetRuns",
        project: undefined,
        json: false,
        url: undefined,
      })
      expect(right(parseAgentArgv(["fleet", "runs", "--project", "demo", "--json"]))).toEqual({
        _tag: "FleetRuns",
        project: "demo",
        json: true,
        url: undefined,
      })
    })

    it("rejects a positional argument on fleet runs", () => {
      expect(left(parseAgentArgv(["fleet", "runs", "extra"])).message).toBe(
        "fleet runs: unexpected argument: extra",
      )
    })

    it("rejects an unknown fleet subcommand", () => {
      expect(left(parseAgentArgv(["fleet", "frobnicate"])).message).toBe(
        "fleet: unknown subcommand: frobnicate",
      )
    })

    it("rejects a bare fleet with no subcommand", () => {
      expect(left(parseAgentArgv(["fleet"])).message).toBe(
        "fleet: unknown subcommand (expected run|runs)",
      )
    })
  })

  describe("rules / rules preview", () => {
    it("defaults json to false for a bare `rules`", () => {
      expect(right(parseAgentArgv(["rules"]))).toEqual({
        _tag: "Rules",
        json: false,
        url: undefined,
      })
    })

    it("parses --json", () => {
      expect(right(parseAgentArgv(["rules", "--json"]))).toEqual({
        _tag: "Rules",
        json: true,
        url: undefined,
      })
    })

    it("rejects a positional argument", () => {
      expect(left(parseAgentArgv(["rules", "extra"])).message).toBe(
        "rules: unexpected argument: extra",
      )
    })

    it("parses `rules preview` with defaults and with --json", () => {
      expect(right(parseAgentArgv(["rules", "preview"]))).toEqual({
        _tag: "RulesPreview",
        json: false,
        url: undefined,
      })
      expect(right(parseAgentArgv(["rules", "preview", "--json"]))).toEqual({
        _tag: "RulesPreview",
        json: true,
        url: undefined,
      })
    })

    it("rejects a positional argument on rules preview", () => {
      expect(left(parseAgentArgv(["rules", "preview", "extra"])).message).toBe(
        "rules preview: unexpected argument: extra",
      )
    })
  })

  describe("terminals", () => {
    it("defaults key to undefined and json to false", () => {
      expect(right(parseAgentArgv(["terminals"]))).toEqual({
        _tag: "Terminals",
        key: undefined,
        json: false,
        url: undefined,
      })
    })

    it("parses a single terminal key and --json", () => {
      expect(right(parseAgentArgv(["terminals", "session:ab12", "--json"]))).toEqual({
        _tag: "Terminals",
        key: "session:ab12",
        json: true,
        url: undefined,
      })
    })

    it("accepts every scope, including the two whose scope doubles as the id", () => {
      for (const key of ["global:global", "orchestrator:orchestrator", "project:pwui"]) {
        expect(right(parseAgentArgv(["terminals", key]))).toEqual({
          _tag: "Terminals",
          key,
          json: false,
          url: undefined,
        })
      }
    })

    it("keeps a colon inside the id — a project id may contain one", () => {
      expect(right(parseAgentArgv(["terminals", "project:a:b"]))).toEqual({
        _tag: "Terminals",
        key: "project:a:b",
        json: false,
        url: undefined,
      })
    })

    it("rejects a bare short — the key must name its scope", () => {
      expect(left(parseAgentArgv(["terminals", "ab12"])).message).toBe(
        'terminals: "ab12" is not a terminal key — expected <scope>:<id>, e.g. session:ab12',
      )
    })

    it("rejects an empty scope or an empty id", () => {
      expect(left(parseAgentArgv(["terminals", ":ab12"])).message).toBe(
        'terminals: ":ab12" is not a terminal key — expected <scope>:<id>, e.g. session:ab12',
      )
      expect(left(parseAgentArgv(["terminals", "session:"])).message).toBe(
        'terminals: "session:" is not a terminal key — expected <scope>:<id>, e.g. session:ab12',
      )
    })

    it("rejects an unknown scope", () => {
      expect(left(parseAgentArgv(["terminals", "pane:ab12"])).message).toBe(
        'terminals: unknown scope "pane" — expected one of: global, orchestrator, project, session',
      )
    })

    it("rejects a second positional", () => {
      expect(left(parseAgentArgv(["terminals", "session:ab12", "session:cd34"])).message).toBe(
        "terminals: unexpected argument: session:cd34",
      )
    })
  })
})

describe("resolveBaseUrl", () => {
  it("prefers the flag over the env var over the default", () => {
    expect(resolveBaseUrl({ flag: "http://flag", env: "http://env" })).toBe("http://flag")
    expect(resolveBaseUrl({ flag: undefined, env: "http://env" })).toBe("http://env")
    expect(resolveBaseUrl({ flag: undefined, env: undefined })).toBe(DEFAULT_PID_URL)
  })
})

describe("resolveApiBase", () => {
  it("uses the bare url when the probe succeeded", () => {
    expect(resolveApiBase({ url: "http://h:1", bareOk: true })).toBe("http://h:1")
  })

  it("appends /__api when the bare probe failed", () => {
    expect(resolveApiBase({ url: "http://h:1", bareOk: false })).toBe("http://h:1/__api")
  })
})

describe("exit codes", () => {
  it("exitCodeForUsage is always 2", () => {
    expect(exitCodeForUsage()).toBe(2)
  })

  it("exitCodeForWaitBody maps ok:true to 0 and each failure reason to its code", () => {
    expect(exitCodeForWaitBody({ ok: true, short: "ab12", state: "done", waitedMs: 1 })).toBe(0)
    expect(exitCodeForWaitBody({ ok: false, short: "ab12", reason: "timeout", waitedMs: 1 })).toBe(
      3,
    )
    expect(
      exitCodeForWaitBody({
        ok: false,
        short: "ab12",
        reason: "occupant_changed",
        waitedMs: undefined,
      }),
    ).toBe(4)
    expect(
      exitCodeForWaitBody({ ok: false, short: "ab12", reason: "removed", waitedMs: undefined }),
    ).toBe(5)
    expect(
      exitCodeForWaitBody({ ok: false, short: "ab12", reason: "not_found", waitedMs: undefined }),
    ).toBe(6)
  })

  it("exitCodeForOutcome maps Ok/NotFound/HttpError, delegating a nested wait", () => {
    expect(exitCodeForOutcome({ _tag: "Ok", wait: undefined })).toBe(0)
    expect(
      exitCodeForOutcome({
        _tag: "Ok",
        wait: { ok: true, short: "ab12", state: "done", waitedMs: 1 },
      }),
    ).toBe(0)
    expect(
      exitCodeForOutcome({
        _tag: "Ok",
        wait: { ok: false, short: "ab12", reason: "removed", waitedMs: undefined },
      }),
    ).toBe(5)
    expect(exitCodeForOutcome({ _tag: "NotFound" })).toBe(6)
    expect(exitCodeForOutcome({ _tag: "HttpError" })).toBe(1)
  })

  it("worstExitCode returns 0 for an empty list", () => {
    expect(worstExitCode([])).toBe(0)
  })

  it("worstExitCode picks the most severe code regardless of input order", () => {
    expect(worstExitCode([0, 3])).toBe(3)
    expect(worstExitCode([3, 4])).toBe(4)
    expect(worstExitCode([4, 5])).toBe(5)
    expect(worstExitCode([5, 6])).toBe(6)
    expect(worstExitCode([6, 1])).toBe(1)
    expect(worstExitCode([1, 6, 3, 4, 5, 0])).toBe(1)
    expect(worstExitCode([0, 0, 0])).toBe(0)
  })

  it("worstExitCode ranks a usage error (2) above every other code", () => {
    expect(worstExitCode([1, 2])).toBe(2)
  })
})

describe("parseWaitOutcomeBody", () => {
  it("rejects a non-object", () => {
    expect(left(parseWaitOutcomeBody("nope")).message).toBe("wait response must be an object")
  })

  it("rejects a missing short", () => {
    expect(left(parseWaitOutcomeBody({ ok: true })).message).toBe("wait response is missing short")
  })

  it("parses a satisfied outcome", () => {
    expect(
      right(parseWaitOutcomeBody({ ok: true, short: "ab12", state: "done", waitedMs: 42 })),
    ).toEqual({
      ok: true,
      short: "ab12",
      state: "done",
      waitedMs: 42,
    })
  })

  it("rejects an unrecognized state on a satisfied outcome", () => {
    expect(
      left(parseWaitOutcomeBody({ ok: true, short: "ab12", state: "bogus", waitedMs: 1 })).message,
    ).toBe('wait response has an unrecognized state: "bogus"')
  })

  it("rejects a missing waitedMs on a satisfied outcome", () => {
    expect(left(parseWaitOutcomeBody({ ok: true, short: "ab12", state: "done" })).message).toBe(
      "wait response is missing waitedMs",
    )
  })

  it("parses every failure reason", () => {
    for (const reason of ["timeout", "occupant_changed", "removed", "not_found"] as const) {
      expect(
        right(parseWaitOutcomeBody({ ok: false, short: "ab12", reason, waitedMs: 9 })),
      ).toEqual({
        ok: false,
        short: "ab12",
        reason,
        waitedMs: 9,
      })
    }
  })

  it("defaults waitedMs to undefined when absent on a failure outcome", () => {
    expect(right(parseWaitOutcomeBody({ ok: false, short: "ab12", reason: "timeout" }))).toEqual({
      ok: false,
      short: "ab12",
      reason: "timeout",
      waitedMs: undefined,
    })
  })

  it("rejects an unrecognized failure reason", () => {
    expect(left(parseWaitOutcomeBody({ ok: false, short: "ab12", reason: "bogus" })).message).toBe(
      'wait response has an unrecognized reason: "bogus"',
    )
  })

  it("rejects a body missing ok entirely", () => {
    expect(left(parseWaitOutcomeBody({ short: "ab12" })).message).toBe(
      "wait response is missing ok",
    )
  })
})

describe("parseSendResponse", () => {
  it("rejects a non-object and a body missing ok/short", () => {
    expect(left(parseSendResponse(null)).message).toBe("send response must be an object")
    expect(left(parseSendResponse({ ok: true })).message).toBe("send response is missing ok/short")
  })

  it("parses a bare success with no wait", () => {
    expect(right(parseSendResponse({ ok: true, short: "ab12" }))).toEqual({
      short: "ab12",
      wait: undefined,
    })
  })

  it("parses a success carrying a nested wait outcome", () => {
    expect(
      right(
        parseSendResponse({
          ok: true,
          short: "ab12",
          wait: { ok: true, short: "ab12", state: "done", waitedMs: 3 },
        }),
      ),
    ).toEqual({ short: "ab12", wait: { ok: true, short: "ab12", state: "done", waitedMs: 3 } })
  })

  it("propagates a malformed nested wait as a ParseError", () => {
    expect(left(parseSendResponse({ ok: true, short: "ab12", wait: { ok: "nope" } })).message).toBe(
      "wait response is missing short",
    )
  })
})

describe("parseKeysResponse", () => {
  it("requires ok/short/resolved/bytes", () => {
    expect(left(parseKeysResponse({ ok: true, short: "ab12" })).message).toBe(
      "keys response is missing resolved",
    )
    expect(
      left(parseKeysResponse({ ok: true, short: "ab12", resolved: ["down", 1] })).message,
    ).toBe("keys response is missing resolved")
    expect(left(parseKeysResponse({ ok: true, short: "ab12", resolved: ["down"] })).message).toBe(
      "keys response is missing bytes",
    )
  })

  it("parses a full response with resolved/bytes and no wait", () => {
    expect(
      right(parseKeysResponse({ ok: true, short: "ab12", resolved: ["down", "enter"], bytes: 4 })),
    ).toEqual({ short: "ab12", resolved: ["down", "enter"], bytes: 4, wait: undefined })
  })

  it("parses a response with a nested wait outcome", () => {
    expect(
      right(
        parseKeysResponse({
          ok: true,
          short: "ab12",
          resolved: ["enter"],
          bytes: 1,
          wait: { ok: false, short: "ab12", reason: "removed" },
        }),
      ),
    ).toEqual({
      short: "ab12",
      resolved: ["enter"],
      bytes: 1,
      wait: { ok: false, short: "ab12", reason: "removed", waitedMs: undefined },
    })
  })
})

describe("parseOkShortResponse / parseDispatchResponse", () => {
  it("parses a well-formed { ok, short }", () => {
    expect(right(parseOkShortResponse({ ok: true, short: "ab12" }))).toEqual({ short: "ab12" })
  })

  it("rejects a missing short or a falsy ok", () => {
    expect(left(parseOkShortResponse({ ok: true })).message).toBe("response is missing ok/short")
    expect(left(parseOkShortResponse({ ok: false, short: "ab12" })).message).toBe(
      "response is missing ok/short",
    )
  })

  it("parses a dispatch response by short alone", () => {
    expect(right(parseDispatchResponse({ short: "ab12" }))).toEqual({ short: "ab12" })
  })

  it("rejects a dispatch response missing short", () => {
    expect(left(parseDispatchResponse({ error: "dispatch_failed" })).message).toBe(
      "dispatch response is missing short",
    )
  })
})

describe("parseSessionsResponse", () => {
  it("rejects a non-array", () => {
    expect(left(parseSessionsResponse({})).message).toBe("sessions response must be an array")
  })

  it("parses a well-formed list", () => {
    expect(
      right(
        parseSessionsResponse([
          {
            short: "ab12",
            state: "working",
            intent: "do the thing",
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        ]),
      ),
    ).toEqual([
      {
        short: "ab12",
        state: "working",
        intent: "do the thing",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ])
  })

  it("drops entries with no short and non-object entries", () => {
    expect(
      right(parseSessionsResponse([{ state: "idle" }, "nope", { short: "ab12", state: "idle" }])),
    ).toEqual([{ short: "ab12", state: "idle", intent: undefined, createdAt: undefined }])
  })

  it("degrades an unrecognized state to unknown instead of failing the list", () => {
    expect(right(parseSessionsResponse([{ short: "ab12", state: "some-future-state" }]))).toEqual([
      { short: "ab12", state: "unknown", intent: undefined, createdAt: undefined },
    ])
  })
})

describe("parseExplainResponse", () => {
  const full = {
    short: "ab12",
    state: "blocked" as const,
    source: "state.json",
    degradedFrom: "weird",
    updatedAtAgeMs: 100,
    lastEventAgeMs: 200,
    pidAlive: false,
    stateFilePresent: true,
    stale: true,
    reasons: ["a", "b"],
  }

  it("parses every field of a full response", () => {
    expect(right(parseExplainResponse(full))).toEqual(full)
  })

  it("defaults every optional field to undefined when absent", () => {
    expect(
      right(
        parseExplainResponse({
          short: "ab12",
          state: "idle",
          source: "roster-seed",
          stateFilePresent: false,
          stale: false,
          reasons: [],
        }),
      ),
    ).toEqual({
      short: "ab12",
      state: "idle",
      source: "roster-seed",
      degradedFrom: undefined,
      updatedAtAgeMs: undefined,
      lastEventAgeMs: undefined,
      pidAlive: undefined,
      stateFilePresent: false,
      stale: false,
      reasons: [],
    })
  })

  it("rejects a missing/unrecognized required field", () => {
    expect(left(parseExplainResponse({ ...full, short: undefined })).message).toBe(
      "explain response is missing short",
    )
    expect(left(parseExplainResponse({ ...full, state: "bogus" })).message).toBe(
      'explain response has an unrecognized state: "bogus"',
    )
    expect(left(parseExplainResponse({ ...full, source: undefined })).message).toBe(
      "explain response is missing source",
    )
    expect(left(parseExplainResponse({ ...full, stateFilePresent: undefined })).message).toBe(
      "explain response is missing stateFilePresent",
    )
    expect(left(parseExplainResponse({ ...full, stale: undefined })).message).toBe(
      "explain response is missing stale",
    )
    expect(left(parseExplainResponse({ ...full, reasons: ["ok", 1] })).message).toBe(
      "explain response is missing reasons",
    )
  })
})

describe("isTerminalStateSlug", () => {
  it("accepts the four screen-classification slugs and rejects session-only ones", () => {
    expect(isTerminalStateSlug("working")).toBe(true)
    expect(isTerminalStateSlug("blocked")).toBe(true)
    expect(isTerminalStateSlug("idle")).toBe(true)
    expect(isTerminalStateSlug("unknown")).toBe(true)
    expect(isTerminalStateSlug("done")).toBe(false)
    expect(isTerminalStateSlug("needs_input")).toBe(false)
  })
})

describe("parseTerminalStatesResponse", () => {
  it("rejects a non-object and an array", () => {
    expect(left(parseTerminalStatesResponse([])).message).toBe(
      "terminals response must be an object",
    )
    expect(left(parseTerminalStatesResponse("nope")).message).toBe(
      "terminals response must be an object",
    )
  })

  it("keys each entry by its map key and keeps the daemon's order", () => {
    expect(
      right(
        parseTerminalStatesResponse({
          "global:global": {
            scope: "global",
            id: "global",
            state: "unknown",
            at: "2026-01-01T00:00:00.000Z",
          },
          "session:ab12": {
            scope: "session",
            id: "ab12",
            state: "idle",
            matcher: "prompt-resting",
            evidence: "❯",
            at: "2026-01-01T00:00:01.000Z",
          },
        }),
      ),
    ).toEqual([
      {
        key: "global:global",
        state: "unknown",
        matcher: undefined,
        evidence: undefined,
        at: "2026-01-01T00:00:00.000Z",
      },
      {
        key: "session:ab12",
        state: "idle",
        matcher: "prompt-resting",
        evidence: "❯",
        at: "2026-01-01T00:00:01.000Z",
      },
    ])
  })

  it("degrades an unrecognized state to unknown and drops a non-object entry", () => {
    expect(
      right(
        parseTerminalStatesResponse({
          "session:ab12": { state: "some-future-state" },
          "session:cd34": "nope",
        }),
      ),
    ).toEqual([
      {
        key: "session:ab12",
        state: "unknown",
        matcher: undefined,
        evidence: undefined,
        at: undefined,
      },
    ])
  })
})

describe("filterTerminalsByKey / exitCodeForTerminalLookup", () => {
  const session = {
    key: "session:ab12",
    state: "idle" as const,
    matcher: undefined,
    evidence: undefined,
    at: undefined,
  }
  const project = {
    key: "project:pwui",
    state: "working" as const,
    matcher: undefined,
    evidence: undefined,
    at: undefined,
  }
  const entries = [session, project]

  it("returns everything when no key was given", () => {
    expect(filterTerminalsByKey({ terminals: entries, key: undefined })).toEqual(entries)
  })

  it("narrows to the one requested key", () => {
    expect(filterTerminalsByKey({ terminals: entries, key: "project:pwui" })).toEqual([project])
  })

  it("returns nothing for a key the daemon has never classified", () => {
    expect(filterTerminalsByKey({ terminals: entries, key: "session:zz99" })).toEqual([])
  })

  it("exits 6 only when a requested key matched nothing", () => {
    expect(exitCodeForTerminalLookup({ key: "session:zz99", matched: 0 })).toBe(6)
    expect(exitCodeForTerminalLookup({ key: "session:ab12", matched: 1 })).toBe(0)
    expect(exitCodeForTerminalLookup({ key: undefined, matched: 0 })).toBe(0)
  })
})

describe("formatTerminalStates", () => {
  it("reports an empty map distinctly", () => {
    expect(formatTerminalStates({ terminals: [], now: 0 })).toBe("no terminal states")
  })

  it("formats one row with its age, matcher and evidence", () => {
    expect(
      formatTerminalStates({
        terminals: [
          {
            key: "session:ab12",
            state: "idle",
            matcher: "prompt-resting",
            evidence: "❯",
            atMs: undefined,
          },
        ],
        now: 1_000_000,
      }),
    ).toBe("session:ab12  idle        —  prompt-resting  ❯")
  })

  it("aligns columns, truncates long evidence and blanks a missing matcher", () => {
    expect(
      formatTerminalStates({
        terminals: [
          {
            key: "global:global",
            state: "unknown",
            matcher: undefined,
            evidence: undefined,
            atMs: 1_000_000 - 65_000,
          },
          {
            key: "session:ab12",
            state: "working",
            matcher: "thinking-gerund",
            evidence: "x".repeat(60),
            atMs: 1_000_000 - 5_000,
          },
        ],
        now: 1_000_000,
      }),
    ).toBe(
      `global:global  unknown    1m  \nsession:ab12   working    5s  thinking-gerund  ${"x".repeat(47)}…`,
    )
  })

  it("shows evidence with no matcher, and a matcher with no evidence", () => {
    expect(
      formatTerminalStates({
        terminals: [
          {
            key: "project:a",
            state: "working",
            matcher: "pi-working",
            evidence: undefined,
            atMs: 0,
          },
        ],
        now: 0,
      }),
    ).toBe("project:a  working    0s  pi-working")
  })
})

describe("parseFleetsResponse", () => {
  const step = {
    id: "review",
    intent: "review the diff",
    n: 3,
    needs: [],
  }

  it("parses a well-formed response with defaults filled in for optional step fields", () => {
    expect(
      right(
        parseFleetsResponse({
          fleets: [{ name: "f", steps: [step], waves: [["review"]] }],
          errors: [],
        }),
      ),
    ).toEqual({
      fleets: [
        {
          name: "f",
          description: undefined,
          waves: [["review"]],
          steps: [
            {
              id: "review",
              intent: "review the diff",
              n: 3,
              needs: [],
              agent: undefined,
              cwd: undefined,
              until: undefined,
              timeoutMs: undefined,
            },
          ],
        },
      ],
      errors: [],
    })
  })

  it("parses full step fields and a fleet description", () => {
    const full = { ...step, agent: "reviewer", cwd: "/tmp", until: ["done"], timeoutMs: 500 }
    expect(
      right(
        parseFleetsResponse({
          fleets: [{ name: "f", description: "d", steps: [full], waves: [["review"]] }],
          errors: [],
        }),
      ).fleets[0],
    ).toEqual({
      name: "f",
      description: "d",
      waves: [["review"]],
      steps: [
        {
          id: "review",
          intent: "review the diff",
          n: 3,
          needs: [],
          agent: "reviewer",
          cwd: "/tmp",
          until: ["done"],
          timeoutMs: 500,
        },
      ],
    })
  })

  it("parses validation errors, defaulting an absent step to undefined", () => {
    expect(
      right(
        parseFleetsResponse({
          fleets: [],
          errors: [
            { fleet: "f", step: "a", message: "bad" },
            { fleet: "f", message: "also bad" },
          ],
        }),
      ).errors,
    ).toEqual([
      { fleet: "f", step: "a", message: "bad" },
      { fleet: "f", step: undefined, message: "also bad" },
    ])
  })

  it("rejects a non-object response", () => {
    expect(left(parseFleetsResponse("nope")).message).toBe("fleets response must be an object")
  })

  it("rejects a missing fleets or errors array", () => {
    expect(left(parseFleetsResponse({ errors: [] })).message).toBe(
      "fleets response is missing fleets",
    )
    expect(left(parseFleetsResponse({ fleets: [] })).message).toBe(
      "fleets response is missing errors",
    )
  })

  it("rejects a step with an unrecognized until state", () => {
    expect(
      left(
        parseFleetsResponse({
          fleets: [{ name: "f", steps: [{ ...step, until: ["nope"] }], waves: [["review"]] }],
          errors: [],
        }),
      ).message,
    ).toBe("fleet step until contains an unrecognized state")
  })
})

describe("parseFleetDryRunResponse / parseFleetRunStarted", () => {
  const wireStep = { id: "review", intent: "review the diff", n: 3, needs: [] }
  const wirePlan = {
    fleet: "review-and-fix",
    waves: [[wireStep]],
    totalSessions: 3,
    maxConcurrentSpawns: 5,
  }

  it("parses a dry run response", () => {
    expect(right(parseFleetDryRunResponse({ plan: wirePlan }))).toEqual({
      plan: {
        fleet: "review-and-fix",
        totalSessions: 3,
        maxConcurrentSpawns: 5,
        waves: [
          [
            {
              id: "review",
              intent: "review the diff",
              n: 3,
              needs: [],
              agent: undefined,
              cwd: undefined,
              until: undefined,
              timeoutMs: undefined,
            },
          ],
        ],
      },
    })
  })

  it("rejects a dry run response missing its plan", () => {
    expect(left(parseFleetDryRunResponse({})).message).toBe("fleet run plan must be an object")
  })

  it("parses a started-run response", () => {
    expect(
      right(parseFleetRunStarted({ runId: "run-1", waves: wirePlan.waves, totalSessions: 3 })),
    ).toEqual({
      runId: "run-1",
      totalSessions: 3,
      waves: [
        [
          {
            id: "review",
            intent: "review the diff",
            n: 3,
            needs: [],
            agent: undefined,
            cwd: undefined,
            until: undefined,
            timeoutMs: undefined,
          },
        ],
      ],
    })
  })

  it("rejects a started-run response missing runId", () => {
    expect(left(parseFleetRunStarted({ waves: [], totalSessions: 0 })).message).toBe(
      "fleet run response is missing runId",
    )
  })
})

describe("parseFleetRunSummary / parseFleetRunsResponse", () => {
  const baseStep = {
    stepId: "review",
    waveIndex: 0,
    intent: "review the diff",
    n: 1,
    status: "done" as const,
    shorts: [
      { short: "ab12", wait: { _tag: "Satisfied" as const, state: "done" as const, waitedMs: 10 } },
    ],
  }
  const baseSummary = {
    id: "run-1",
    projectId: "demo",
    fleet: "review-and-fix",
    status: "done" as const,
    totalSessions: 1,
    startedAt: 1000,
    steps: [baseStep],
  }

  it("parses a well-formed run summary, defaulting finishedAt/reason to undefined", () => {
    expect(right(parseFleetRunSummary(baseSummary))).toEqual({
      ...baseSummary,
      finishedAt: undefined,
      steps: [{ ...baseStep, reason: undefined }],
    })
  })

  it("parses finishedAt and a step reason when present", () => {
    const withExtras = {
      ...baseSummary,
      finishedAt: 2000,
      steps: [{ ...baseStep, status: "skipped", reason: 'dependency "a" did not complete' }],
    }
    const parsed = right(parseFleetRunSummary(withExtras))
    expect(parsed.finishedAt).toBe(2000)
    expect(parsed.steps[0]?.reason).toBe('dependency "a" did not complete')
  })

  it.each([
    "Timeout",
    "OccupantChanged",
    "Removed",
    "NotFound",
  ])("parses a %s wait outcome on a short", (tag) => {
    const outcome = tag === "Timeout" ? { _tag: tag, waitedMs: 5 } : { _tag: tag }
    const withOutcome = {
      ...baseSummary,
      steps: [{ ...baseStep, shorts: [{ short: "ab12", wait: outcome }] }],
    }
    expect(right(parseFleetRunSummary(withOutcome)).steps[0]?.shorts[0]?.wait).toEqual(outcome)
  })

  it("rejects an unrecognized run status", () => {
    expect(left(parseFleetRunSummary({ ...baseSummary, status: "nope" })).message).toBe(
      'fleet run summary has an unrecognized status: "nope"',
    )
  })

  it("rejects an unrecognized step status", () => {
    const bad = { ...baseSummary, steps: [{ ...baseStep, status: "nope" }] }
    expect(left(parseFleetRunSummary(bad)).message).toBe(
      'fleet run step has an unrecognized status: "nope"',
    )
  })

  it("rejects an unrecognized wait outcome shape", () => {
    const bad = {
      ...baseSummary,
      steps: [{ ...baseStep, shorts: [{ short: "ab12", wait: { _tag: "nope" } }] }],
    }
    expect(left(parseFleetRunSummary(bad)).message).toBe(
      "fleet run wait outcome has an unrecognized shape",
    )
  })

  it("parses a list of run summaries from parseFleetRunsResponse", () => {
    expect(right(parseFleetRunsResponse({ runs: [baseSummary] }))).toEqual([
      { ...baseSummary, finishedAt: undefined, steps: [{ ...baseStep, reason: undefined }] },
    ])
  })

  it("rejects a runs response with no runs array", () => {
    expect(left(parseFleetRunsResponse({})).message).toBe(
      "fleet runs response must have a runs array",
    )
  })
})

describe("exitCodeForFleetRunStatus", () => {
  it("is 0 for done and 7 for anything else", () => {
    expect(exitCodeForFleetRunStatus("done")).toBe(0)
    expect(exitCodeForFleetRunStatus("failed")).toBe(7)
    expect(exitCodeForFleetRunStatus("running")).toBe(7)
  })
})

describe("errorMessageFrom", () => {
  it("prefers message, then detail, then error", () => {
    expect(errorMessageFrom({ message: "m", detail: "d", error: "e" })).toBe("m")
    expect(errorMessageFrom({ detail: "d", error: "e" })).toBe("d")
    expect(errorMessageFrom({ error: "e" })).toBe("e")
  })

  it("falls back to a generic message for a non-object or no known field", () => {
    expect(errorMessageFrom("nope")).toBe("unknown error")
    expect(errorMessageFrom({})).toBe("unknown error")
    expect(errorMessageFrom({ message: "" })).toBe("unknown error")
  })
})

describe("request body building", () => {
  it("buildWaitRequestBody omits timeoutMs when absent", () => {
    expect(buildWaitRequestBody({ until: ["done"], timeoutMs: undefined })).toEqual({
      until: ["done"],
    })
    expect(buildWaitRequestBody({ until: ["done"], timeoutMs: 500 })).toEqual({
      until: ["done"],
      timeoutMs: 500,
    })
  })

  it("buildSendRequestBody omits wait when absent", () => {
    expect(buildSendRequestBody({ keys: "hi", wait: undefined })).toEqual({ keys: "hi" })
    expect(
      buildSendRequestBody({ keys: "hi", wait: { until: ["done"], timeoutMs: undefined } }),
    ).toEqual({
      keys: "hi",
      wait: { until: ["done"] },
    })
  })

  it("buildKeysRequestBody maps names to named steps, one per repetition", () => {
    expect(buildKeysRequestBody({ names: ["down", "down", "enter"], wait: undefined })).toEqual({
      sequence: [{ named: "down" }, { named: "down" }, { named: "enter" }],
    })
    expect(
      buildKeysRequestBody({ names: ["enter"], wait: { until: ["idle"], timeoutMs: 10 } }),
    ).toEqual({
      sequence: [{ named: "enter" }],
      wait: { until: ["idle"], timeoutMs: 10 },
    })
  })

  it("buildDispatchRequestBody only includes cwd/agent when given", () => {
    expect(buildDispatchRequestBody({ intent: "go", cwd: undefined, agent: undefined })).toEqual({
      intent: "go",
    })
    expect(buildDispatchRequestBody({ intent: "go", cwd: "/tmp", agent: undefined })).toEqual({
      intent: "go",
      cwd: "/tmp",
    })
    expect(buildDispatchRequestBody({ intent: "go", cwd: undefined, agent: "reviewer" })).toEqual({
      intent: "go",
      agent: "reviewer",
    })
    expect(buildDispatchRequestBody({ intent: "go", cwd: "/tmp", agent: "reviewer" })).toEqual({
      intent: "go",
      cwd: "/tmp",
      agent: "reviewer",
    })
  })

  it("buildFleetRunRequestBody carries dryRun through explicitly", () => {
    expect(buildFleetRunRequestBody({ dryRun: true })).toEqual({ dryRun: true })
    expect(buildFleetRunRequestBody({ dryRun: false })).toEqual({ dryRun: false })
  })
})

describe("formatSessions", () => {
  it("reports an empty list distinctly", () => {
    expect(formatSessions({ sessions: [], now: 0 })).toBe("no sessions")
  })

  it("formats a single row with age and intent", () => {
    expect(
      formatSessions({
        sessions: [
          { short: "short1", state: "working", intent: "hello world", createdAtMs: undefined },
        ],
        now: 1_000_000,
      }),
    ).toBe("short1  working     —  hello world")
  })

  it("aligns columns, truncates a long intent, and blanks a missing one", () => {
    expect(
      formatSessions({
        sessions: [
          { short: "ab12", state: "idle", intent: "x".repeat(60), createdAtMs: 1_000_000 - 65_000 },
          { short: "cdef34", state: "working", intent: undefined, createdAtMs: 1_000_000 - 5_000 },
        ],
        now: 1_000_000,
      }),
    ).toBe(`ab12    idle       1m  ${"x".repeat(47)}…\ncdef34  working    5s  `)
  })
})

describe("formatExplain", () => {
  it("formats a stale, fully-populated explanation", () => {
    expect(
      formatExplain({
        short: "ab12",
        state: "blocked",
        source: "state.json",
        degradedFrom: undefined,
        updatedAtAgeMs: 7_200_000,
        lastEventAgeMs: 5_000,
        pidAlive: true,
        stateFilePresent: true,
        stale: true,
        reasons: ["reason one", "reason two"],
      }),
    ).toBe(
      "ab12  blocked (stale)\nsource: state.json\nupdated: 2h ago\nlast event: 5s ago\npid alive: true\n- reason one\n- reason two",
    )
  })

  it("omits the pid-alive line and the stale suffix when not applicable", () => {
    expect(
      formatExplain({
        short: "cd34",
        state: "idle",
        source: "roster-seed",
        degradedFrom: undefined,
        updatedAtAgeMs: undefined,
        lastEventAgeMs: undefined,
        pidAlive: undefined,
        stateFilePresent: false,
        stale: false,
        reasons: [],
      }),
    ).toBe("cd34  idle\nsource: roster-seed\nupdated: — ago\nlast event: — ago")
  })
})

describe("one-line confirmations", () => {
  it("formatWaitOutcome describes a satisfied wait and each failure", () => {
    expect(formatWaitOutcome({ ok: true, short: "ab12", state: "done", waitedMs: 1234 })).toBe(
      'ab12 reached "done" after 1234ms',
    )
    expect(
      formatWaitOutcome({ ok: false, short: "ab12", reason: "timeout", waitedMs: 30000 }),
    ).toBe("ab12 timed out waiting")
    expect(
      formatWaitOutcome({
        ok: false,
        short: "ab12",
        reason: "occupant_changed",
        waitedMs: undefined,
      }),
    ).toBe("ab12 occupant changed")
    expect(
      formatWaitOutcome({ ok: false, short: "ab12", reason: "removed", waitedMs: undefined }),
    ).toBe("ab12 was removed")
    expect(
      formatWaitOutcome({ ok: false, short: "ab12", reason: "not_found", waitedMs: undefined }),
    ).toBe("ab12 was not found")
  })

  it("formatSent appends the wait outcome only when present", () => {
    expect(formatSent({ short: "ab12", wait: undefined })).toBe("sent to ab12")
    expect(
      formatSent({
        short: "ab12",
        wait: { ok: true, short: "ab12", state: "done", waitedMs: 500 },
      }),
    ).toBe('sent to ab12; ab12 reached "done" after 500ms')
  })

  it("formatKeysSent lists the resolved trail and byte count", () => {
    expect(
      formatKeysSent({
        short: "ab12",
        resolved: ["down", "down", "enter"],
        bytes: 6,
        wait: undefined,
      }),
    ).toBe("sent [down, down, enter] (6 bytes) to ab12")
    expect(
      formatKeysSent({
        short: "ab12",
        resolved: ["enter"],
        bytes: 1,
        wait: { ok: false, short: "ab12", reason: "removed", waitedMs: undefined },
      }),
    ).toBe("sent [enter] (1 bytes) to ab12; ab12 was removed")
  })

  it("formatStopped / formatRemoved report the short plainly", () => {
    expect(formatStopped("ab12")).toBe("stopped ab12")
    expect(formatRemoved("ab12")).toBe("removed ab12")
  })

  it("formatSpawned truncates a long intent and appends any wait outcome", () => {
    expect(formatSpawned({ short: "ab12", intent: "y".repeat(70), wait: undefined })).toBe(
      `spawned ab12 — ${"y".repeat(59)}…`,
    )
    expect(
      formatSpawned({
        short: "ab12",
        intent: "go",
        wait: { ok: true, short: "ab12", state: "working", waitedMs: 10 },
      }),
    ).toBe('spawned ab12 — go; ab12 reached "working" after 10ms')
  })
})

describe("filterByState", () => {
  const items: ReadonlyArray<{ readonly state: "done" | "idle" }> = [
    { state: "done" },
    { state: "idle" },
  ]

  it("returns the input unchanged when no states are given", () => {
    expect(filterByState({ items, states: undefined })).toBe(items)
    expect(filterByState({ items, states: [] })).toBe(items)
  })

  it("keeps only items whose state is in the list", () => {
    expect(filterByState({ items, states: ["done"] })).toEqual([{ state: "done" }])
    expect(filterByState({ items, states: ["idle", "done"] })).toEqual(items)
    expect(filterByState({ items, states: ["failed"] })).toEqual([])
  })
})

describe("formatFleets / exitCodeForFleets", () => {
  it("reports when there are no recipes at all", () => {
    expect(formatFleets({ fleets: [], errors: [] })).toBe(
      "no fleet recipes (.pid/fleet.json not found or empty)",
    )
    expect(exitCodeForFleets({ fleets: [], errors: [] })).toBe(0)
  })

  it("formats a fleet's waves, with and without a description", () => {
    expect(
      formatFleets({
        fleets: [
          {
            name: "review-and-fix",
            description: "three reviewers, then one fixer",
            steps: [],
            waves: [["review"], ["fix"]],
          },
        ],
        errors: [],
      }),
    ).toBe("review-and-fix — three reviewers, then one fixer\n  wave 1: review\n  wave 2: fix")

    expect(
      formatFleets({
        fleets: [{ name: "solo", description: undefined, steps: [], waves: [["only"]] }],
        errors: [],
      }),
    ).toBe("solo\n  wave 1: only")
  })

  it("lists every validation error, attributing a step when one is named", () => {
    const response = {
      fleets: [],
      errors: [
        { fleet: "f", step: "fix", message: 'needs unknown step: "ghost"' },
        { fleet: "f", step: undefined, message: "dependency cycle detected among steps: a, b" },
      ],
    }
    expect(formatFleets(response)).toBe(
      '2 recipe error(s):\n  [f] step "fix": needs unknown step: "ghost"\n  [f] dependency cycle detected among steps: a, b',
    )
    expect(exitCodeForFleets(response)).toBe(2)
  })

  it("shows both valid fleets and errors together when a file has some of each", () => {
    const response = {
      fleets: [{ name: "ok", description: undefined, steps: [], waves: [["a"]] }],
      errors: [{ fleet: "bad", step: undefined, message: "fleet name must be a non-empty string" }],
    }
    expect(formatFleets(response)).toBe(
      "ok\n  wave 1: a\n\n1 recipe error(s):\n  [bad] fleet name must be a non-empty string",
    )
    expect(exitCodeForFleets(response)).toBe(2)
  })
})

describe("fleet run formatting", () => {
  const wirePlan = {
    fleet: "review-and-fix",
    totalSessions: 4,
    maxConcurrentSpawns: 5,
    waves: [
      [
        {
          id: "review",
          intent: "review",
          n: 3,
          agent: undefined,
          cwd: undefined,
          needs: [],
          until: undefined,
          timeoutMs: undefined,
        },
      ],
      [
        {
          id: "fix",
          intent: "fix",
          n: 1,
          agent: undefined,
          cwd: undefined,
          needs: ["review"],
          until: undefined,
          timeoutMs: undefined,
        },
      ],
    ],
  }

  it("formatFleetDryRun reports the fleet, totals and per-step needs", () => {
    expect(formatFleetDryRun({ plan: wirePlan })).toBe(
      "dry run — review-and-fix: 4 session(s) across 2 wave(s)\n" +
        "  wave 1: review (n=3)\n" +
        "  wave 2: fix (n=1, needs: review)",
    )
  })

  it("formatFleetRunStarted reports the runId in place of the dry-run header", () => {
    expect(formatFleetRunStarted({ runId: "run-1", ...wirePlan })).toBe(
      "started run-1 — 4 session(s) across 2 wave(s)\n" +
        "  wave 1: review (n=3)\n" +
        "  wave 2: fix (n=1, needs: review)",
    )
  })

  it("formatFleetRunSummary reports status, shorts and a skip reason", () => {
    const summary = {
      id: "run-1",
      projectId: "demo",
      fleet: "review-and-fix",
      status: "done" as const,
      totalSessions: 1,
      startedAt: 0,
      finishedAt: 5,
      steps: [
        {
          stepId: "review",
          waveIndex: 0,
          intent: "review",
          n: 1,
          status: "done" as const,
          shorts: [{ short: "ab12", wait: undefined }],
          reason: undefined,
        },
        {
          stepId: "fix",
          waveIndex: 1,
          intent: "fix",
          n: 1,
          status: "skipped" as const,
          shorts: [],
          reason: 'dependency "review" did not complete',
        },
      ],
    }
    expect(formatFleetRunSummary(summary)).toBe(
      "run-1 — review-and-fix: done\n" +
        "  [wave 1] review: done (ab12)\n" +
        '  [wave 2] fix: skipped — dependency "review" did not complete',
    )
  })

  it("formatFleetRuns lists id/fleet/status columns, or a placeholder when empty", () => {
    expect(formatFleetRuns([])).toBe("no fleet runs")
    const runs = [
      { id: "run-1", fleet: "review-and-fix", status: "done" as const },
      { id: "run-2", fleet: "fix", status: "running" as const },
      // biome-ignore lint/suspicious/noExplicitAny: only id/fleet/status matter to this formatter
    ] as any
    expect(formatFleetRuns(runs)).toBe(
      `run-1  review-and-fix  done\nrun-2  ${"fix".padEnd(14)}  running`,
    )
  })
})

describe("parseRulesStatusResponse", () => {
  it("parses a well-formed response", () => {
    expect(
      right(
        parseRulesStatusResponse({
          enabled: true,
          paused: false,
          errors: [],
          rules: [{ name: "r", enabled: true }],
          log: [{ _tag: "Fired", rule: "r", short: "ab12", at: 100 }],
        }),
      ),
    ).toEqual({
      enabled: true,
      paused: false,
      errors: [],
      rules: [{ name: "r", enabled: true }],
      log: [{ tag: "Fired", rule: "r", short: "ab12", at: 100 }],
    })
  })

  it("rejects a non-object response", () => {
    expect(left(parseRulesStatusResponse(null)).message).toBe("rules response must be an object")
  })

  it("requires enabled, paused, errors, rules and log", () => {
    const full = { enabled: false, paused: false, errors: [], rules: [], log: [] }
    expect(left(parseRulesStatusResponse({ ...full, enabled: undefined })).message).toBe(
      "rules response is missing enabled",
    )
    expect(left(parseRulesStatusResponse({ ...full, paused: undefined })).message).toBe(
      "rules response is missing paused",
    )
    expect(left(parseRulesStatusResponse({ ...full, errors: undefined })).message).toBe(
      "rules response is missing errors",
    )
    expect(left(parseRulesStatusResponse({ ...full, rules: undefined })).message).toBe(
      "rules response is missing rules",
    )
    expect(left(parseRulesStatusResponse({ ...full, log: undefined })).message).toBe(
      "rules response is missing log",
    )
  })

  it("surfaces every rule error, attributing it to the rule it belongs to", () => {
    const response = {
      enabled: false,
      paused: false,
      errors: [{ rule: "r", message: "cooldownMs must be an integer between 0 and 86400000" }],
      rules: [],
      log: [],
    }
    expect(right(parseRulesStatusResponse(response)).errors).toEqual(response.errors)
  })
})

describe("parseRulesPreviewResponse", () => {
  it("parses Fired and Suppressed outcomes", () => {
    expect(
      right(
        parseRulesPreviewResponse({
          errors: [],
          outcomes: [
            { _tag: "Fired", rule: "r1", short: "ab12" },
            { _tag: "Suppressed", rule: "r2", short: "cd34" },
          ],
        }),
      ),
    ).toEqual({
      errors: [],
      outcomes: [
        { tag: "Fired", rule: "r1", short: "ab12" },
        { tag: "Suppressed", rule: "r2", short: "cd34" },
      ],
    })
  })

  it("rejects an outcome with an unrecognized _tag", () => {
    expect(
      left(
        parseRulesPreviewResponse({
          errors: [],
          outcomes: [{ _tag: "Exploded", rule: "r", short: "ab12" }],
        }),
      ).message,
    ).toBe('preview outcome has an unrecognized _tag: "Exploded"')
  })

  it("requires errors and outcomes", () => {
    // The "missing errors" message is shared with parseRulesStatusResponse's
    // own errors field (both reuse the same parseRuleErrors helper).
    expect(left(parseRulesPreviewResponse({ outcomes: [] })).message).toBe(
      "rules response is missing errors",
    )
    expect(left(parseRulesPreviewResponse({ errors: [] })).message).toBe(
      "rules preview response is missing outcomes",
    )
  })
})

describe("formatRulesStatus / exitCodeForRulesErrors", () => {
  it("reports disabled/paused state and 'no rules configured'", () => {
    expect(
      formatRulesStatus({ enabled: false, paused: false, errors: [], rules: [], log: [] }),
    ).toBe("state-change rules: disabled\n\nno rules configured")
  })

  it("reports enabled + paused together, and lists rules with their enabled state", () => {
    expect(
      formatRulesStatus({
        enabled: true,
        paused: true,
        errors: [],
        rules: [
          { name: "notify-on-blocked", enabled: true },
          { name: "old-rule", enabled: false },
        ],
        log: [],
      }),
    ).toBe("state-change rules: enabled (paused)\n\n  notify-on-blocked\n  old-rule (disabled)")
  })

  it("lists validation errors and recent activity, and exits 2 on any error", () => {
    const withErrors = {
      enabled: false,
      paused: false,
      errors: [{ rule: "r", message: "name must be a non-empty string" }],
      rules: [],
      log: [],
    }
    expect(formatRulesStatus(withErrors)).toContain(
      "1 rule error(s):\n  [r] name must be a non-empty string",
    )
    expect(exitCodeForRulesErrors(withErrors.errors)).toBe(2)

    const withLog = {
      enabled: true,
      paused: false,
      errors: [],
      rules: [{ name: "r", enabled: true }],
      log: [{ tag: "Fired", rule: "r", short: "ab12", at: 1 }],
    }
    expect(formatRulesStatus(withLog)).toContain("recent activity:\n  Fired r → ab12")
    expect(exitCodeForRulesErrors(withLog.errors)).toBe(0)
  })
})

describe("formatRulesPreview", () => {
  it("reports 'nothing would fire' when there are no outcomes", () => {
    expect(formatRulesPreview({ errors: [], outcomes: [] })).toBe("preview: nothing would fire")
  })

  it("formats a mix of Fired and Suppressed outcomes", () => {
    expect(
      formatRulesPreview({
        errors: [],
        outcomes: [
          { tag: "Fired", rule: "r1", short: "ab12" },
          { tag: "Suppressed", rule: "r2", short: "cd34" },
        ],
      }),
    ).toBe("would fire: r1 → ab12\nsuppressed: r2 → cd34")
  })

  it("reports validation errors instead of outcomes when the file is invalid", () => {
    expect(
      formatRulesPreview({
        errors: [{ rule: "(file)", message: "root must be an object" }],
        outcomes: [],
      }),
    ).toBe("1 rule error(s):\n  [(file)] root must be an object")
  })
})
