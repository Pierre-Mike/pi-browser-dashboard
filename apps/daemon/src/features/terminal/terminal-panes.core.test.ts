import { describe, expect, it } from "bun:test"
import { Either } from "effect"
import {
  boundedDetail,
  decideClosePane,
  decideCreatePane,
  mintPaneName,
  normalizePaneId,
  PANE_REFUSALS,
  parseCreatedPaneId,
  parsePaneCloseRequest,
  parsePaneCreateRequest,
  refusalMessage,
  refusalStatus,
  resolveOwnedSession,
  zellijClosePaneArgv,
  zellijNewPaneArgv,
} from "./terminal-panes.core"
import { MAX_PANES_PER_SESSION, type PollCandidate, parseSessionList } from "./terminal-poll.core"

// The daemon's own derivation, exactly as the poller builds it: scope + id +
// the zellij session name that scope/id resolves to. A request names a scope and
// an id and NOTHING else, so a caller cannot even express a session name.
const CANDIDATES: ReadonlyArray<PollCandidate> = [
  { scope: "global", id: "global", sessionName: "polltest-default" },
  { scope: "session", id: "ab12cd34", sessionName: "polltest-ab12cd34" },
  { scope: "project", id: "my-repo", sessionName: "polltest-my-repo" },
]

// Verbatim `zellij list-sessions --no-formatting` (0.44.3): the session behind
// `project:my-repo` is not running, and one unrelated live session belongs to
// somebody else entirely.
const SESSIONS = parseSessionList(`polltest-default [Created 12h ago]
polltest-ab12cd34 [Created 3m ago]
somebody-elses-session [Created 1day ago]
polltest-dead [Created 2days ago] (EXITED - attach to resurrect)
`)

// Verbatim `zellij --session <name> action list-panes` for a session holding the
// layout's own pane plus one this daemon created (captured 2026-07-29).
const PANES_WITH_OURS = `PANE_ID  TYPE  TITLE
plugin_1  plugin  zellij:status-bar
terminal_0  terminal  pierre-mikel@mac-1:~/Github/pi-browser-dashboard
terminal_3  terminal  pid-pane-1
`

const ONE_PANE = `PANE_ID  TYPE  TITLE
terminal_3  terminal  pid-pane-1
`

const createRequest = (over?: Partial<Parameters<typeof decideCreatePane>[0]>) =>
  decideCreatePane({
    scope: "session",
    id: "ab12cd34",
    candidates: CANDIDATES,
    sessions: SESSIONS,
    cwd: undefined,
    cwdExists: undefined,
    command: undefined,
    paneName: "pid-pane-1",
    terminalPaneCount: 1,
    ...over,
  })

describe("resolveOwnedSession", () => {
  it("resolves a scope+id the daemon derived AND zellij reports live", () => {
    const r = resolveOwnedSession({
      scope: "session",
      id: "ab12cd34",
      candidates: CANDIDATES,
      sessions: SESSIONS,
    })
    expect(Either.getOrNull(r)).toBe("polltest-ab12cd34")
  })

  // The whole safety property in one test: ownership is derivation, never a
  // guess about what a name looks like.
  it("refuses a scope+id the daemon never derived", () => {
    const r = resolveOwnedSession({
      scope: "session",
      id: "somebody-elses-session",
      candidates: CANDIDATES,
      sessions: SESSIONS,
    })
    expect(Either.isLeft(r)).toBe(true)
    expect(Either.getOrElse(Either.flip(r), () => "")).toBe("not_derived")
  })

  it("refuses a derived terminal whose zellij session is not running", () => {
    const r = resolveOwnedSession({
      scope: "project",
      id: "my-repo",
      candidates: CANDIDATES,
      sessions: SESSIONS,
    })
    expect(Either.getOrElse(Either.flip(r), () => "")).toBe("not_live")
  })

  it("refuses an EXITED session — resurrectable is not live", () => {
    const r = resolveOwnedSession({
      scope: "session",
      id: "dead",
      candidates: [{ scope: "session", id: "dead", sessionName: "polltest-dead" }],
      sessions: SESSIONS,
    })
    expect(Either.getOrElse(Either.flip(r), () => "")).toBe("not_live")
  })

  it("refuses the same id under a scope it was not derived for", () => {
    const r = resolveOwnedSession({
      scope: "project",
      id: "ab12cd34",
      candidates: CANDIDATES,
      sessions: SESSIONS,
    })
    expect(Either.getOrElse(Either.flip(r), () => "")).toBe("not_derived")
  })
})

describe("decideCreatePane", () => {
  it("builds the argv for an owned, live session", () => {
    const d = createRequest()
    expect(d._tag).toBe("Create")
    if (d._tag !== "Create") return
    expect(d.sessionName).toBe("polltest-ab12cd34")
    expect(d.paneName).toBe("pid-pane-1")
    expect(d.argv).toEqual([
      "zellij",
      "--session",
      "polltest-ab12cd34",
      "action",
      "new-pane",
      "--name",
      "pid-pane-1",
    ])
  })

  it("passes a caller command after `--`, never through a shell", () => {
    const d = createRequest({ command: ["bun", "run", "test"] })
    if (d._tag !== "Create") throw new Error("expected Create")
    expect(d.argv.slice(-4)).toEqual(["--", "bun", "run", "test"])
  })

  // zellij ACCEPTS a --cwd that does not exist: it creates the pane anyway and
  // runs the command somewhere else entirely (verified 0.44.3). A pane silently
  // running in the wrong directory is worse than a refusal — and `Bun.spawn`
  // into a missing cwd has taken this daemon down before.
  it("refuses a cwd that does not exist rather than letting zellij ignore it", () => {
    const d = createRequest({ cwd: "/definitely/not/here", cwdExists: false })
    expect(d).toEqual({ _tag: "Refused", reason: "cwd_missing" })
  })

  it("passes an existing cwd through as --cwd", () => {
    const d = createRequest({ cwd: "/tmp", cwdExists: true })
    if (d._tag !== "Create") throw new Error("expected Create")
    expect(d.argv).toContain("--cwd")
    expect(d.argv[d.argv.indexOf("--cwd") + 1]).toBe("/tmp")
  })

  it("refuses a session the daemon did not derive, before building any argv", () => {
    expect(createRequest({ id: "somebody-elses-session" })).toEqual({
      _tag: "Refused",
      reason: "not_derived",
    })
  })

  it("refuses a session that is not live", () => {
    expect(createRequest({ scope: "project", id: "my-repo" })).toEqual({
      _tag: "Refused",
      reason: "not_live",
    })
  })

  // A pane the poller cannot reach is a pane nothing can observe, which is the
  // opposite of the point. The cap is the poller's own MAX_PANES_PER_SESSION.
  it("refuses to create a pane the screen poller would never classify", () => {
    expect(createRequest({ terminalPaneCount: 4 })).toEqual({
      _tag: "Refused",
      reason: "pane_budget",
    })
  })
})

describe("decideClosePane", () => {
  const record = {
    scope: "session" as const,
    id: "ab12cd34",
    paneId: "terminal_3",
    paneName: "pid-pane-1",
    sessionName: "polltest-ab12cd34",
  }
  const closeRequest = (over?: Partial<Parameters<typeof decideClosePane>[0]>) =>
    decideClosePane({
      record,
      panes: PANES_WITH_OURS,
      callerPaneId: undefined,
      callerSessionName: undefined,
      ...over,
    })

  it("closes a pane it created, still present and still carrying its minted name", () => {
    const d = closeRequest()
    expect(d._tag).toBe("Close")
    if (d._tag !== "Close") return
    expect(d.argv).toEqual([
      "zellij",
      "--session",
      "polltest-ab12cd34",
      "action",
      "close-pane",
      "--pane-id",
      "terminal_3",
    ])
  })

  // The bookkeeping IS the permission. No record — including every record lost
  // to a daemon restart — means the daemon cannot know it created this pane, and
  // it refuses rather than guessing.
  it("refuses a pane it has no record of", () => {
    expect(closeRequest({ record: undefined })).toEqual({
      _tag: "Refused",
      reason: "not_created_here",
    })
  })

  // Pane ids restart at 0 for a recreated session, so an id alone is not an
  // identity. `--name` survives a program setting its own OSC title (verified
  // 0.44.3), which makes the minted name checkable.
  it("refuses when the live pane no longer carries the name the daemon minted", () => {
    const renamed = `PANE_ID  TYPE  TITLE
terminal_3  terminal  somebody-elses-shell
`
    expect(closeRequest({ panes: renamed })).toEqual({
      _tag: "Refused",
      reason: "not_created_here",
    })
  })

  it("reports a pane that is already gone as gone, not as an error", () => {
    const gone = `PANE_ID  TYPE  TITLE
terminal_0  terminal  bash
`
    expect(closeRequest({ panes: gone })).toEqual({ _tag: "AlreadyGone" })
  })

  // Closing a session's only pane leaves the session alive with ZERO panes
  // (verified 0.44.3) — a teardown by another name, and this surface never tears
  // a session down.
  it("refuses to close the session's last terminal pane", () => {
    expect(closeRequest({ panes: ONE_PANE })).toEqual({ _tag: "Refused", reason: "last_pane" })
  })

  // An agent asking to close the pane it is running in. Refused cheerfully: the
  // alternative is killing the caller mid-request.
  it("refuses when the target is the caller's own pane", () => {
    expect(
      closeRequest({ callerPaneId: "terminal_3", callerSessionName: "polltest-ab12cd34" }),
    ).toEqual({ _tag: "Refused", reason: "own_pane" })
  })

  // ZELLIJ_PANE_ID is a bare number inside a pane; list-panes and close-pane
  // speak `terminal_<n>`. Both spellings must recognise the same pane.
  it("recognises the caller's own pane from the bare ZELLIJ_PANE_ID form", () => {
    expect(closeRequest({ callerPaneId: "3", callerSessionName: "polltest-ab12cd34" })).toEqual({
      _tag: "Refused",
      reason: "own_pane",
    })
  })

  it("does not mistake the same pane id in another session for the caller's own", () => {
    const d = closeRequest({ callerPaneId: "3", callerSessionName: "some-other-session" })
    expect(d._tag).toBe("Close")
  })

  it("ignores a caller pane id it cannot make sense of", () => {
    const d = closeRequest({ callerPaneId: "not-a-pane", callerSessionName: "polltest-ab12cd34" })
    expect(d._tag).toBe("Close")
  })
})

describe("normalizePaneId / parseCreatedPaneId / mintPaneName", () => {
  it("accepts both spellings of a terminal pane id", () => {
    expect(normalizePaneId("terminal_7")).toBe("terminal_7")
    expect(normalizePaneId("7")).toBe("terminal_7")
  })

  it("rejects a plugin pane and anything else", () => {
    expect(normalizePaneId("plugin_1")).toBeUndefined()
    expect(normalizePaneId("")).toBeUndefined()
    expect(normalizePaneId("terminal_")).toBeUndefined()
    expect(normalizePaneId("../../etc/passwd")).toBeUndefined()
  })

  // `action new-pane` prints the id it created on stdout and exits 0 (verified
  // 0.44.3) — that string is the only reason the daemon can know which pane is
  // its own.
  it("reads the created pane id off new-pane's stdout", () => {
    expect(parseCreatedPaneId("terminal_1\n")).toBe("terminal_1")
    expect(parseCreatedPaneId("  terminal_12  \n")).toBe("terminal_12")
  })

  it("is undefined when new-pane printed something else", () => {
    expect(parseCreatedPaneId("")).toBeUndefined()
    expect(parseCreatedPaneId("Session 'x' not found. The following sessions are active:")).toBe(
      undefined,
    )
    expect(parseCreatedPaneId("plugin_2\n")).toBeUndefined()
  })

  it("mints a name that carries no caller input at all", () => {
    expect(mintPaneName({ seq: 1 })).toBe("pid-pane-1")
    expect(mintPaneName({ seq: 42 })).toBe("pid-pane-42")
  })
})

describe("parsePaneCreateRequest", () => {
  it("accepts a scope and an id", () => {
    const r = parsePaneCreateRequest({ scope: "session", id: "ab12cd34" })
    expect(Either.getOrNull(r)).toEqual({
      scope: "session",
      id: "ab12cd34",
      cwd: undefined,
      command: undefined,
    })
  })

  it("accepts a cwd and an argv command", () => {
    const r = parsePaneCreateRequest({
      scope: "session",
      id: "ab12cd34",
      cwd: "/tmp",
      command: ["bash", "-lc", "echo hi"],
    })
    expect(Either.getOrNull(r)?.command).toEqual(["bash", "-lc", "echo hi"])
  })

  it.each([
    [{}, "scope"],
    [{ scope: "session" }, "id"],
    [{ scope: "nope", id: "ab12" }, "scope"],
    [{ scope: "session", id: "" }, "id"],
    [{ scope: "session", id: "ab12", cwd: 7 }, "cwd"],
    [{ scope: "session", id: "ab12", command: "bash -lc x" }, "command"],
    [{ scope: "session", id: "ab12", command: [] }, "command"],
    [{ scope: "session", id: "ab12", command: [1, 2] }, "command"],
  ])("rejects %p", (raw, mentions) => {
    const r = parsePaneCreateRequest(raw)
    expect(Either.isLeft(r)).toBe(true)
    expect(Either.getOrElse(Either.flip(r), () => ({ message: "" })).message).toContain(mentions)
  })

  // The pane's command reaches zellij as argv, so there is no shell to inject
  // into — but an unbounded argv would still be a way to hand the daemon a
  // megabyte to spawn.
  it("rejects a command longer than the cap", () => {
    const r = parsePaneCreateRequest({
      scope: "session",
      id: "ab12",
      command: Array.from({ length: 40 }, () => "x"),
    })
    expect(Either.isLeft(r)).toBe(true)
  })
})

describe("parsePaneCloseRequest", () => {
  it("accepts scope, id and a pane id, normalising the pane id", () => {
    const r = parsePaneCloseRequest({ scope: "session", id: "ab12", paneId: "3" })
    expect(Either.getOrNull(r)).toEqual({
      scope: "session",
      id: "ab12",
      paneId: "terminal_3",
      callerPaneId: undefined,
      callerSessionName: undefined,
    })
  })

  // Both arrive from the caller's own environment, so they are untrusted by
  // construction: they can only ever make the daemon refuse, never let it do
  // more, which is why a bogus value is carried through rather than rejected.
  it("carries the caller's self-reported pane and session through untouched", () => {
    const r = parsePaneCloseRequest({
      scope: "session",
      id: "ab12",
      paneId: "terminal_3",
      callerPaneId: "9",
      callerSessionName: "whatever",
    })
    expect(Either.getOrNull(r)?.callerPaneId).toBe("9")
    expect(Either.getOrNull(r)?.callerSessionName).toBe("whatever")
  })

  it.each([
    [{ scope: "session", id: "ab12" }, "paneId"],
    [{ scope: "session", id: "ab12", paneId: "plugin_1" }, "paneId"],
    [{ scope: "session", id: "ab12", paneId: "terminal_x" }, "paneId"],
    [{ id: "ab12", paneId: "3" }, "scope"],
  ])("rejects %p", (raw, mentions) => {
    const r = parsePaneCloseRequest(raw)
    expect(Either.isLeft(r)).toBe(true)
    expect(Either.getOrElse(Either.flip(r), () => ({ message: "" })).message).toContain(mentions)
  })
})

describe("refusalMessage", () => {
  it("explains every refusal, distinctly", () => {
    const messages = PANE_REFUSALS.map((r) => refusalMessage(r))
    expect(messages.every((m) => m.length > 20)).toBe(true)
    expect(new Set(messages).size).toBe(PANE_REFUSALS.length)
  })

  it("says WHY a cwd is refused rather than only that it was", () => {
    expect(refusalMessage("cwd_missing")).toContain("zellij would accept it silently")
  })

  it("names the pane cap it enforces", () => {
    expect(refusalMessage("pane_budget")).toContain(String(MAX_PANES_PER_SESSION))
  })
})

describe("refusalStatus", () => {
  it("answers not-found for the two ownership refusals", () => {
    expect(refusalStatus("not_derived")).toBe(404)
    expect(refusalStatus("not_live")).toBe(404)
  })

  it("answers 400 for a caller-supplied path that does not exist", () => {
    expect(refusalStatus("cwd_missing")).toBe(400)
  })

  it("answers 409 for every policy refusal", () => {
    expect(refusalStatus("pane_budget")).toBe(409)
    expect(refusalStatus("not_created_here")).toBe(409)
    expect(refusalStatus("own_pane")).toBe(409)
    expect(refusalStatus("last_pane")).toBe(409)
  })
})

// A failing `zellij action` prints its whole session list to stderr — 60KB of it
// on the machine this was written on. None of that belongs in an HTTP response.
describe("boundedDetail", () => {
  it("keeps a short message whole", () => {
    expect(boundedDetail({ text: "Session 'x' not found.", maxChars: 200 })).toBe(
      "Session 'x' not found.",
    )
  })

  it("keeps only the first line, and bounds it", () => {
    const huge = `Session 'x' not found. The following sessions are active:\n${"a".repeat(70_000)}`
    const out = boundedDetail({ text: huge, maxChars: 40 })
    expect(out.length).toBeLessThanOrEqual(41)
    expect(out.startsWith("Session 'x' not found.")).toBe(true)
  })

  it("is empty for empty output rather than inventing a message", () => {
    expect(boundedDetail({ text: "   \n\n", maxChars: 200 })).toBe("")
  })
})

describe("zellij argv builders", () => {
  it("names the session explicitly and never relies on an ambient one", () => {
    expect(zellijNewPaneArgv({ sessionName: "s", paneName: "pid-pane-2" })).toEqual([
      "zellij",
      "--session",
      "s",
      "action",
      "new-pane",
      "--name",
      "pid-pane-2",
    ])
  })

  it("targets close-pane by id, which works without an attached client", () => {
    expect(zellijClosePaneArgv({ sessionName: "s", paneId: "terminal_3" })).toEqual([
      "zellij",
      "--session",
      "s",
      "action",
      "close-pane",
      "--pane-id",
      "terminal_3",
    ])
  })

  // Two argv shapes this module must never be able to build, whatever it is
  // asked for: they are the ones that end a session rather than a pane.
  it("has no way to build kill-session or delete-session", () => {
    const built = [
      ...zellijNewPaneArgv({ sessionName: "s", paneName: "n" }),
      ...zellijClosePaneArgv({ sessionName: "s", paneId: "terminal_1" }),
    ].join(" ")
    expect(built).not.toContain("kill-session")
    expect(built).not.toContain("delete-session")
    expect(built).not.toContain("kill-all-sessions")
  })
})
