import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect, ManagedRuntime } from "effect"
import { sseBus } from "../../platform/sse-bus"
import { SessionRegistry, SessionRegistryLive } from "./sessions.io"

const writeRoster = async (cfg: string, workers: Record<string, unknown>): Promise<void> => {
  await mkdir(join(cfg, "daemon"), { recursive: true })
  await writeFile(
    join(cfg, "daemon", "roster.json"),
    JSON.stringify({ supervisorPid: 99, updatedAt: Date.now(), workers }),
  )
}

const writeState = async ({
  cfg,
  short,
  body,
}: {
  cfg: string
  short: string
  body: Record<string, unknown>
}): Promise<void> => {
  await mkdir(join(cfg, "jobs", short), { recursive: true })
  await writeFile(join(cfg, "jobs", short, "state.json"), JSON.stringify(body))
}

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

// fswatch polls every 500ms; give it two cycles + margin so CI under load
// still sees the change deterministically.
const POLL_WAIT_MS = 1200

type SseRecord = { type: string; data: unknown }

type Diagnostics = {
  readonly session: SessionState
  readonly updatedAtMs: number | undefined
  readonly lastEventAtMs: number | undefined
  readonly pidAlive: boolean | undefined
  readonly stateFilePresent: boolean
}

type RegistryApi = {
  readonly snapshot: () => Promise<ReadonlyArray<SessionState>>
  readonly getOne: (short: string) => Promise<SessionState | undefined>
  readonly diagnostics: (short: string) => Promise<Diagnostics | undefined>
}

type SessionState = {
  readonly short: string
  readonly state: string
  readonly source: string
  readonly degradedFrom: string | undefined
  readonly detail: string | undefined
  readonly intent: string | undefined
  readonly cwd: string | undefined
  readonly sessionId: string | undefined
}

// A pid guaranteed to have already exited by the time the caller uses it —
// signal-0 against it must fail, unlike stubbing isPidAlive (as pi-sessions
// does), sessions.io probes process.kill directly.
const deadPid = (): number => Bun.spawnSync(["true"]).pid

let cfg: string
let originalConfigDir: string | undefined
let runtime: ManagedRuntime.ManagedRuntime<SessionRegistry, never> | null = null
let sseBusUnsub: (() => boolean) | null = null

const startRegistry = async (): Promise<RegistryApi> => {
  runtime = ManagedRuntime.make(SessionRegistryLive)
  const api = await runtime.runPromise(Effect.flatMap(SessionRegistry, (r) => Effect.succeed(r)))
  return api as RegistryApi
}

const recordSse = (filter?: (e: SseRecord) => boolean): SseRecord[] => {
  const events: SseRecord[] = []
  const unsub = sseBus.subscribe((e) => {
    const r = e as SseRecord
    if (!filter || filter(r)) events.push(r)
  })
  sseBusUnsub = unsub as () => boolean
  return events
}

beforeEach(async () => {
  cfg = await mkdtemp(join(tmpdir(), "pid-sessions-repo-"))
  originalConfigDir = process.env.CLAUDE_CONFIG_DIR
  process.env.CLAUDE_CONFIG_DIR = cfg
})

afterEach(async () => {
  if (sseBusUnsub) {
    sseBusUnsub()
    sseBusUnsub = null
  }
  if (runtime) {
    await runtime.dispose()
    runtime = null
  }
  if (originalConfigDir === undefined) {
    Reflect.deleteProperty(process.env, "CLAUDE_CONFIG_DIR")
  } else {
    process.env.CLAUDE_CONFIG_DIR = originalConfigDir
  }
  await rm(cfg, { recursive: true, force: true })
})

describe("SessionRegistry — initial reconciliation", () => {
  it("treats a missing roster.json as empty", async () => {
    const api = await startRegistry()
    expect(await api.snapshot()).toEqual([])
  })

  it("seeds sessions from roster.json on boot, before state.json arrives", async () => {
    await writeRoster(cfg, {
      ab12: {
        sessionId: "sess-1",
        cwd: "/repo",
        dispatch: { agent: "reviewer", seed: { intent: "do thing" } },
      },
    })
    const api = await startRegistry()
    const snap = await api.snapshot()
    expect(snap).toHaveLength(1)
    expect(snap[0]?.short).toBe("ab12")
    expect(snap[0]?.state).toBe("idle")
    expect(snap[0]?.intent).toBe("do thing")
    expect(snap[0]?.cwd).toBe("/repo")
    expect(snap[0]?.sessionId).toBe("sess-1")
  })

  it("merges state.json on top of roster-seeded fields", async () => {
    await writeRoster(cfg, { ab12: { sessionId: "sess-1", cwd: "/repo" } })
    await writeState({
      cfg,
      short: "ab12",
      body: {
        state: "working",
        detail: "compiling",
        createdAt: "2024-01-01T00:00:00.000Z",
      },
    })
    const api = await startRegistry()
    // The state.json read fires on watcher attach but resolves async; give it
    // a tick so the merged snapshot is in.
    await wait(200)
    const one = await api.getOne("ab12")
    expect(one?.state).toBe("working")
    expect(one?.detail).toBe("compiling")
    // Roster-derived fields survive when state.json doesn't repeat them.
    expect(one?.sessionId).toBe("sess-1")
    expect(one?.cwd).toBe("/repo")
  })
})

describe("SessionRegistry — jobs dir scan", () => {
  it("seeds sessions from jobs/*/state.json on boot even without a roster entry", async () => {
    await writeState({
      cfg,
      short: "old1",
      body: { state: "done", detail: "shipped", sessionId: "sess-old", cwd: "/repo" },
    })
    const api = await startRegistry()
    await wait(200) // initial state.json read settles
    const one = await api.getOne("old1")
    expect(one?.state).toBe("done")
    expect(one?.detail).toBe("shipped")
    expect(one?.sessionId).toBe("sess-old")
  })

  it("removes a rosterless session when its job dir is deleted (claude rm)", async () => {
    await writeState({ cfg, short: "old1", body: { state: "done" } })
    const api = await startRegistry()
    await wait(200) // initial state.json read settles
    const events = recordSse((e) => e.type === "session.removed")
    await rm(join(cfg, "jobs", "old1"), { recursive: true, force: true })
    await wait(POLL_WAIT_MS)
    expect(events).toEqual([{ type: "session.removed", data: { short: "old1" } }])
    expect(await api.getOne("old1")).toBeUndefined()
  })

  it("keeps a roster-tracked session when state.json is briefly absent", async () => {
    await writeRoster(cfg, { ab12: {} })
    await writeState({ cfg, short: "ab12", body: { state: "working" } })
    const api = await startRegistry()
    await wait(200)
    await rm(join(cfg, "jobs", "ab12", "state.json"), { force: true })
    await wait(POLL_WAIT_MS)
    expect((await api.getOne("ab12"))?.short).toBe("ab12")
  })
})

describe("SessionRegistry — roster delta", () => {
  it("publishes session.created + roster.changed when a new worker appears", async () => {
    const api = await startRegistry()
    const events = recordSse((e) =>
      ["session.created", "session.removed", "roster.changed"].includes(e.type),
    )
    await writeRoster(cfg, { ab12: { sessionId: "s1" } })
    await wait(POLL_WAIT_MS)
    expect(events.filter((e) => e.type === "session.created")).toHaveLength(1)
    expect(events.filter((e) => e.type === "roster.changed").length).toBeGreaterThanOrEqual(1)
    expect((await api.getOne("ab12"))?.short).toBe("ab12")
  })

  it("publishes session.removed and stops tracking when a worker leaves the roster", async () => {
    await writeRoster(cfg, { ab12: {} })
    const api = await startRegistry()
    const events = recordSse((e) => e.type === "session.removed")
    await writeRoster(cfg, {})
    await wait(POLL_WAIT_MS)
    expect(events).toEqual([{ type: "session.removed", data: { short: "ab12" } }])
    expect(await api.getOne("ab12")).toBeUndefined()
  })

  it("retains a session whose state.json persists when its worker leaves the roster", async () => {
    await writeRoster(cfg, { ab12: {} })
    await writeState({ cfg, short: "ab12", body: { state: "done", detail: "PR merged" } })
    const api = await startRegistry()
    await wait(200) // initial state.json read settles
    const events = recordSse((e) => e.type === "session.removed")
    await writeRoster(cfg, {})
    await wait(POLL_WAIT_MS)
    expect(events).toEqual([])
    expect((await api.getOne("ab12"))?.state).toBe("done")
    expect((await api.getOne("ab12"))?.detail).toBe("PR merged")
  })
})

describe("SessionRegistry — state.json delta", () => {
  it("publishes session.state when a watched state.json changes", async () => {
    await writeRoster(cfg, { ab12: {} })
    await writeState({ cfg, short: "ab12", body: { state: "idle" } })
    const api = await startRegistry()
    await wait(200) // initial state.json read settles
    const events = recordSse((e) => e.type === "session.state")
    await writeState({ cfg, short: "ab12", body: { state: "working", detail: "now" } })
    await wait(POLL_WAIT_MS)
    expect(events.length).toBeGreaterThanOrEqual(1)
    const latest = events[events.length - 1]?.data as {
      state: string
      detail: string | undefined
    }
    expect(latest.state).toBe("working")
    expect(latest.detail).toBe("now")
    expect((await api.getOne("ab12"))?.state).toBe("working")
  })

  it("does not clobber the in-memory snapshot when state.json is mid-write (empty file)", async () => {
    await writeRoster(cfg, { ab12: {} })
    await writeState({ cfg, short: "ab12", body: { state: "working" } })
    const api = await startRegistry()
    await wait(POLL_WAIT_MS)
    // Truncate the file mid-write. readJsonWithRetry returns null after 5 *
    // 50ms when the file stays empty, and refreshState bails before writing
    // anything — the prior snapshot stays intact.
    await writeFile(join(cfg, "jobs", "ab12", "state.json"), "")
    await wait(POLL_WAIT_MS)
    expect((await api.getOne("ab12"))?.state).toBe("working")
  })
})

// A session whose state.json carries a `daemonShort` is exposed under that
// alias (state.short === daemonShort), but the registry map is keyed by the
// job-dir name. getOne is called with the short the UI holds — the exposed
// one — so it must resolve the alias, or the terminal WS, GET, stop, and rm
// all fail with "session <id> not found" for a session that lists fine.
describe("SessionRegistry — daemonShort alias", () => {
  it("getOne resolves a session by its exposed short when daemonShort differs from the job dir", async () => {
    await writeRoster(cfg, { jobdir1: {} })
    await writeState({
      cfg,
      short: "jobdir1",
      body: { state: "working", detail: "attached", daemonShort: "claude-alias" },
    })
    const api = await startRegistry()
    await wait(200) // initial state.json read settles

    // The list exposes the alias …
    const snap = await api.snapshot()
    expect(snap.map((s) => s.short)).toContain("claude-alias")

    // … so a by-id lookup with that same alias must succeed.
    const one = await api.getOne("claude-alias")
    expect(one?.state).toBe("working")
    expect(one?.detail).toBe("attached")
  })
})

// Reads must stay correct even when the runtime's timers stop firing
// (observed in production: Bun's timer subsystem died after hours of uptime —
// sockets kept serving but every 500ms poll watcher froze, so sessions
// created afterwards never appeared until a daemon restart). snapshot() and
// getOne() therefore reconcile on-disk changes before returning, without
// waiting for a poll cycle.
describe("SessionRegistry — refresh on read (timer-independent)", () => {
  it("reflects a roster worker added after boot on an immediate read", async () => {
    const api = await startRegistry()
    await writeRoster(cfg, { ab12: { sessionId: "s1", cwd: "/repo" } })
    const snap = await api.snapshot()
    expect(snap.map((s) => s.short)).toContain("ab12")
  })

  it("reflects a state.json change on an immediate read", async () => {
    await writeRoster(cfg, { ab12: {} })
    await writeState({ cfg, short: "ab12", body: { state: "idle" } })
    const api = await startRegistry()
    await writeState({ cfg, short: "ab12", body: { state: "working", detail: "now" } })
    const one = await api.getOne("ab12")
    expect(one?.state).toBe("working")
    expect(one?.detail).toBe("now")
  })

  it("discovers a rosterless job dir created after boot on an immediate read", async () => {
    const api = await startRegistry()
    await writeState({ cfg, short: "late1", body: { state: "done", detail: "shipped" } })
    const one = await api.getOne("late1")
    expect(one?.state).toBe("done")
    expect(one?.detail).toBe("shipped")
  })
})

// GET /:id/explain's data source: everything `getOne` returns, plus the
// on-disk/pid facts only the registry can see.
describe("SessionRegistry — diagnostics", () => {
  it("resolves the daemonShort alias, same as getOne", async () => {
    await writeRoster(cfg, { jobdir1: { pid: process.pid } })
    await writeState({
      cfg,
      short: "jobdir1",
      body: { state: "working", daemonShort: "claude-alias" },
    })
    const api = await startRegistry()
    await wait(200) // initial state.json read settles
    const diag = await api.diagnostics("claude-alias")
    expect(diag?.session.short).toBe("claude-alias")
    expect(diag?.session.state).toBe("working")
    expect(diag?.stateFilePresent).toBe(true)
    // The registry's own process is alive for the whole test run.
    expect(diag?.pidAlive).toBe(true)
  })

  it("returns undefined for a short the registry has never heard of", async () => {
    const api = await startRegistry()
    expect(await api.diagnostics("missing")).toBeUndefined()
  })

  it("reports stateFilePresent: false for a roster-tracked worker with no state.json yet", async () => {
    await writeRoster(cfg, { ab12: { sessionId: "s1" } })
    const api = await startRegistry()
    const diag = await api.diagnostics("ab12")
    expect(diag?.session.source).toBe("roster-seed")
    expect(diag?.stateFilePresent).toBe(false)
  })

  it("reports pidAlive: false for a worker whose pid has already exited", async () => {
    await writeRoster(cfg, { ab12: { pid: deadPid() } })
    await writeState({ cfg, short: "ab12", body: { state: "working" } })
    const api = await startRegistry()
    await wait(200) // initial state.json read settles
    const diag = await api.diagnostics("ab12")
    expect(diag?.pidAlive).toBe(false)
  })

  it("reports pidAlive: undefined when the roster never carried a pid for this worker", async () => {
    await writeRoster(cfg, { ab12: { sessionId: "s1" } })
    await writeState({ cfg, short: "ab12", body: { state: "working" } })
    const api = await startRegistry()
    await wait(200) // initial state.json read settles
    const diag = await api.diagnostics("ab12")
    expect(diag?.pidAlive).toBeUndefined()
  })

  it("records lastEventAtMs from the most recent session.state publish", async () => {
    await writeRoster(cfg, { ab12: {} })
    await writeState({ cfg, short: "ab12", body: { state: "idle" } })
    const api = await startRegistry()
    await wait(200) // initial state.json read settles
    const before = Date.now()
    await writeState({ cfg, short: "ab12", body: { state: "working" } })
    await api.getOne("ab12") // drives the refresh-on-read pass that observes it
    const diag = await api.diagnostics("ab12")
    expect(diag?.lastEventAtMs).toBeGreaterThanOrEqual(before)
  })
})
