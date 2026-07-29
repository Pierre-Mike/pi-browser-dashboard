import { describe, expect, it } from "bun:test"
import { createPaneWriter, type PaneWritePorts } from "./terminal-panes.io"
import type { PollCandidate } from "./terminal-poll.core"

const SESSION_LIST = `polltest-default [Created 12h ago]
polltest-ab12cd34 [Created 3m ago]
`

const LAYOUT_PANE = "terminal_0  terminal  bash -lc claude attach ab12cd34"

type Harness = {
  readonly ports: PaneWritePorts
  readonly ran: string[][]
  readonly panes: Map<string, string[]>
  readonly missingDirs: Set<string>
  setZellijFailure: (input: { readonly stdout: string }) => void
}

// A fake zellij: `new-pane` appends a row to the session's pane list and prints
// the id it minted, exactly as the real one does; `close-pane` removes the row.
const makeHarness = (overrides?: Partial<PaneWritePorts>): Harness => {
  const ran: string[][] = []
  const panes = new Map<string, string[]>([
    ["polltest-default", [LAYOUT_PANE]],
    ["polltest-ab12cd34", [LAYOUT_PANE]],
  ])
  const missingDirs = new Set<string>(["/definitely/not/here"])
  let nextPaneIndex = 1
  let failure: { readonly stdout: string } | undefined

  const candidates: ReadonlyArray<PollCandidate> = [
    { scope: "global", id: "global", sessionName: "polltest-default" },
    { scope: "session", id: "ab12cd34", sessionName: "polltest-ab12cd34" },
    { scope: "project", id: "not-running", sessionName: "polltest-not-running" },
  ]

  // `zellij --session <name> action <verb> …`, so the session is argv[2] and the
  // verb argv[4] — the same positions the real argv builders produce.
  const sessionOf = (argv: ReadonlyArray<string>): string => argv[2] ?? ""
  const rowsOf = (argv: ReadonlyArray<string>): ReadonlyArray<string> =>
    panes.get(sessionOf(argv)) ?? []
  const flagOf = (input: { readonly argv: ReadonlyArray<string>; readonly flag: string }): string =>
    input.argv[input.argv.indexOf(input.flag) + 1] ?? ""

  const fakeNewPane = (
    argv: ReadonlyArray<string>,
  ): { readonly ok: boolean; readonly output: string } => {
    const paneId = `terminal_${nextPaneIndex}`
    nextPaneIndex += 1
    panes.set(sessionOf(argv), [
      ...rowsOf(argv),
      `${paneId}  terminal  ${flagOf({ argv, flag: "--name" })}`,
    ])
    return { ok: true, output: `${paneId}\n` }
  }

  const fakeClosePane = (
    argv: ReadonlyArray<string>,
  ): { readonly ok: boolean; readonly output: string } => {
    const paneId = flagOf({ argv, flag: "--pane-id" })
    panes.set(
      sessionOf(argv),
      rowsOf(argv).filter((row) => !row.startsWith(`${paneId} `)),
    )
    return { ok: true, output: "" }
  }

  const runZellij: PaneWritePorts["runZellij"] = async ({ argv }) => {
    ran.push([...argv])
    if (failure !== undefined) return { ok: false, output: failure.stdout }
    return argv[4] === "new-pane" ? fakeNewPane(argv) : fakeClosePane(argv)
  }

  const ports: PaneWritePorts = {
    listCandidates: async () => candidates,
    listSessions: async () => SESSION_LIST,
    listPanes: async ({ sessionName }) =>
      `PANE_ID  TYPE  TITLE\n${(panes.get(sessionName) ?? []).join("\n")}\n`,
    directoryExists: ({ path }) => !missingDirs.has(path),
    runZellij,
    ...overrides,
  }

  return {
    ports,
    ran,
    panes,
    missingDirs,
    setZellijFailure: (input) => {
      failure = input
    },
  }
}

const target = { scope: "session", id: "ab12cd34" } as const

describe("createPaneWriter.create", () => {
  it("opens a pane in an owned, live session and reports the id zellij minted", async () => {
    const h = makeHarness()
    const out = await createPaneWriter({ ports: h.ports }).create({
      ...target,
      cwd: undefined,
      command: undefined,
    })
    expect(out).toEqual({
      _tag: "Created",
      scope: "session",
      id: "ab12cd34",
      paneId: "terminal_1",
      paneName: "pid-pane-1",
      sessionName: "polltest-ab12cd34",
    })
    expect(h.ran[0]).toEqual([
      "zellij",
      "--session",
      "polltest-ab12cd34",
      "action",
      "new-pane",
      "--name",
      "pid-pane-1",
    ])
  })

  it("refuses a terminal the daemon never derived, without spawning anything", async () => {
    const h = makeHarness()
    const out = await createPaneWriter({ ports: h.ports }).create({
      scope: "session",
      id: "somebody-elses-session",
      cwd: undefined,
      command: undefined,
    })
    expect(out).toEqual({ _tag: "Refused", reason: "not_derived" })
    expect(h.ran).toEqual([])
  })

  it("refuses a derived terminal whose session is not running, without spawning anything", async () => {
    const h = makeHarness()
    const out = await createPaneWriter({ ports: h.ports }).create({
      scope: "project",
      id: "not-running",
      cwd: undefined,
      command: undefined,
    })
    expect(out).toEqual({ _tag: "Refused", reason: "not_live" })
    expect(h.ran).toEqual([])
  })

  // zellij accepts a --cwd that does not exist and runs the command elsewhere,
  // and `Bun.spawn` into a missing cwd has taken this daemon down before. The
  // guard is the daemon's, and it runs before any spawn.
  it("refuses a cwd that does not exist, without spawning anything", async () => {
    const h = makeHarness()
    const out = await createPaneWriter({ ports: h.ports }).create({
      ...target,
      cwd: "/definitely/not/here",
      command: ["bash", "-lc", "echo hi"],
    })
    expect(out).toEqual({ _tag: "Refused", reason: "cwd_missing" })
    expect(h.ran).toEqual([])
  })

  it("passes an existing cwd and command through to zellij", async () => {
    const h = makeHarness()
    await createPaneWriter({ ports: h.ports }).create({
      ...target,
      cwd: "/tmp",
      command: ["bun", "test"],
    })
    expect(h.ran[0]?.slice(-5)).toEqual(["--cwd", "/tmp", "--", "bun", "test"])
  })

  it("refuses once the session holds as many panes as the poller will classify", async () => {
    const h = makeHarness()
    const writer = createPaneWriter({ ports: h.ports })
    // One layout pane plus three of ours reaches MAX_PANES_PER_SESSION.
    for (let i = 0; i < 3; i++) {
      expect((await writer.create({ ...target, cwd: undefined, command: undefined }))._tag).toBe(
        "Created",
      )
    }
    expect(await writer.create({ ...target, cwd: undefined, command: undefined })).toEqual({
      _tag: "Refused",
      reason: "pane_budget",
    })
  })

  it("reports a zellij failure with a bounded detail, and records nothing", async () => {
    const h = makeHarness()
    const writer = createPaneWriter({ ports: h.ports })
    h.setZellijFailure({
      stdout: `Session 'x' not found. The following sessions are active:\n${"noise\n".repeat(9_000)}`,
    })
    const out = await writer.create({ ...target, cwd: undefined, command: undefined })
    expect(out._tag).toBe("ZellijFailed")
    if (out._tag !== "ZellijFailed") return
    expect(out.detail.length).toBeLessThan(300)
    expect(out.detail).toContain("not found")
  })

  it("reports a zellij success that printed no pane id as a failure, not a pane", async () => {
    const h = makeHarness({ runZellij: async () => ({ ok: true, output: "" }) })
    const out = await createPaneWriter({ ports: h.ports }).create({
      ...target,
      cwd: undefined,
      command: undefined,
    })
    expect(out._tag).toBe("ZellijFailed")
  })
})

describe("createPaneWriter.close", () => {
  const closeArgs = (paneId: string) => ({
    ...target,
    paneId,
    callerPaneId: undefined,
    callerSessionName: undefined,
  })

  it("closes a pane it created", async () => {
    const h = makeHarness()
    const writer = createPaneWriter({ ports: h.ports })
    await writer.create({ ...target, cwd: undefined, command: undefined })
    expect(await writer.close(closeArgs("terminal_1"))).toEqual({
      _tag: "Closed",
      paneId: "terminal_1",
    })
    expect(h.ran[1]).toEqual([
      "zellij",
      "--session",
      "polltest-ab12cd34",
      "action",
      "close-pane",
      "--pane-id",
      "terminal_1",
    ])
  })

  it("refuses to close a pane it did not create, without spawning anything", async () => {
    const h = makeHarness()
    const writer = createPaneWriter({ ports: h.ports })
    await writer.create({ ...target, cwd: undefined, command: undefined })
    // terminal_0 is the layout's own pane, sitting right there in list-panes.
    expect(await writer.close(closeArgs("terminal_0"))).toEqual({
      _tag: "Refused",
      reason: "not_created_here",
    })
    expect(h.ran).toHaveLength(1)
  })

  // The bookkeeping is in memory, so a restart loses it — and a daemon that
  // cannot know it created a pane must refuse rather than guess. A second writer
  // over the same zellij state is exactly what a restart looks like.
  it("refuses after a restart, when the record is gone but the pane is not", async () => {
    const h = makeHarness()
    const before = createPaneWriter({ ports: h.ports })
    await before.create({ ...target, cwd: undefined, command: undefined })
    const afterRestart = createPaneWriter({ ports: h.ports })
    expect(await afterRestart.close(closeArgs("terminal_1"))).toEqual({
      _tag: "Refused",
      reason: "not_created_here",
    })
    expect(h.ran).toHaveLength(1)
  })

  it("refuses the caller's own pane, and leaves it running", async () => {
    const h = makeHarness()
    const writer = createPaneWriter({ ports: h.ports })
    await writer.create({ ...target, cwd: undefined, command: undefined })
    const out = await writer.close({
      ...closeArgs("terminal_1"),
      callerPaneId: "1",
      callerSessionName: "polltest-ab12cd34",
    })
    expect(out).toEqual({ _tag: "Refused", reason: "own_pane" })
    expect(h.ran).toHaveLength(1)
  })

  it("refuses the session's last pane, so a close can never end a session", async () => {
    const h = makeHarness()
    const writer = createPaneWriter({ ports: h.ports })
    await writer.create({ ...target, cwd: undefined, command: undefined })
    // The layout's pane goes away on its own (its command exited).
    h.panes.set("polltest-ab12cd34", ["terminal_1  terminal  pid-pane-1"])
    expect(await writer.close(closeArgs("terminal_1"))).toEqual({
      _tag: "Refused",
      reason: "last_pane",
    })
    expect(h.ran).toHaveLength(1)
  })

  it("reports a pane that has already gone, and forgets it", async () => {
    const h = makeHarness()
    const writer = createPaneWriter({ ports: h.ports })
    await writer.create({ ...target, cwd: undefined, command: undefined })
    h.panes.set("polltest-ab12cd34", [LAYOUT_PANE])
    expect(await writer.close(closeArgs("terminal_1"))).toEqual({
      _tag: "AlreadyGone",
      paneId: "terminal_1",
    })
    // Forgotten: a second call cannot be answered any more.
    expect(await writer.close(closeArgs("terminal_1"))).toEqual({
      _tag: "Refused",
      reason: "not_created_here",
    })
  })

  it("forgets a closed pane, so closing it twice is refused rather than repeated", async () => {
    const h = makeHarness()
    const writer = createPaneWriter({ ports: h.ports })
    await writer.create({ ...target, cwd: undefined, command: undefined })
    await writer.close(closeArgs("terminal_1"))
    expect(await writer.close(closeArgs("terminal_1"))).toEqual({
      _tag: "Refused",
      reason: "not_created_here",
    })
  })

  it("keeps the record when zellij refused the close, so it can be retried", async () => {
    const h = makeHarness()
    const writer = createPaneWriter({ ports: h.ports })
    await writer.create({ ...target, cwd: undefined, command: undefined })
    h.setZellijFailure({ stdout: "zellij exploded" })
    expect((await writer.close(closeArgs("terminal_1")))._tag).toBe("ZellijFailed")
    // Still ours, still closable once zellij behaves.
    expect((await writer.close(closeArgs("terminal_1")))._tag).toBe("ZellijFailed")
  })

  it("never closes a pane of another terminal that happens to share the pane id", async () => {
    const h = makeHarness()
    const writer = createPaneWriter({ ports: h.ports })
    await writer.create({ ...target, cwd: undefined, command: undefined })
    const out = await writer.close({
      scope: "global",
      id: "global",
      paneId: "terminal_1",
      callerPaneId: undefined,
      callerSessionName: undefined,
    })
    expect(out).toEqual({ _tag: "Refused", reason: "not_created_here" })
  })
})

// The two argv shapes that end a session rather than a pane must never appear,
// whatever this writer is asked to do.
describe("createPaneWriter never tears a session down", () => {
  it("spawns no kill-session or delete-session across every path", async () => {
    const h = makeHarness()
    const writer = createPaneWriter({ ports: h.ports })
    await writer.create({ ...target, cwd: undefined, command: undefined })
    await writer.create({ ...target, cwd: "/definitely/not/here", command: undefined })
    await writer.close({
      ...target,
      paneId: "terminal_0",
      callerPaneId: undefined,
      callerSessionName: undefined,
    })
    await writer.close({
      ...target,
      paneId: "terminal_1",
      callerPaneId: undefined,
      callerSessionName: undefined,
    })
    const flat = h.ran.flat().join(" ")
    expect(flat).not.toContain("kill-session")
    expect(flat).not.toContain("delete-session")
    expect(flat).not.toContain("kill-all-sessions")
    expect(flat).not.toContain("write-chars")
  })
})
