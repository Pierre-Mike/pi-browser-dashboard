import { describe, expect, it } from "bun:test"
import { Either } from "effect"
import {
  buildDispatchRequestBody,
  buildKeysRequestBody,
  buildSendRequestBody,
  buildWaitRequestBody,
  DEFAULT_PID_URL,
  errorMessageFrom,
  exitCodeForFleets,
  exitCodeForOutcome,
  exitCodeForUsage,
  exitCodeForWaitBody,
  filterByState,
  formatExplain,
  formatFleets,
  formatKeysSent,
  formatRemoved,
  formatSent,
  formatSessions,
  formatSpawned,
  formatStopped,
  formatWaitOutcome,
  isNamedKeyName,
  isSessionStateSlug,
  parseAgentArgv,
  parseDispatchResponse,
  parseExplainResponse,
  parseFleetsResponse,
  parseKeysResponse,
  parseOkShortResponse,
  parseSendResponse,
  parseSessionsResponse,
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
