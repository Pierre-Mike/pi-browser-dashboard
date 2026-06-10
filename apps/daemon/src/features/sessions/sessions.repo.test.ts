import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect, ManagedRuntime } from "effect"
import { sseBus } from "../../platform/sse-bus"
import { SessionRegistry, SessionRegistryLive } from "./sessions.repo"

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

type RegistryApi = {
  readonly snapshot: () => ReadonlyArray<SessionState>
  readonly getOne: (short: string) => SessionState | undefined
}

type SessionState = {
  readonly short: string
  readonly state: string
  readonly detail: string | undefined
  readonly intent: string | undefined
  readonly cwd: string | undefined
  readonly sessionId: string | undefined
}

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
    expect(api.snapshot()).toEqual([])
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
    const snap = api.snapshot()
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
    const one = api.getOne("ab12")
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
    const one = api.getOne("old1")
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
    expect(api.getOne("old1")).toBeUndefined()
  })

  it("keeps a roster-tracked session when state.json is briefly absent", async () => {
    await writeRoster(cfg, { ab12: {} })
    await writeState({ cfg, short: "ab12", body: { state: "working" } })
    const api = await startRegistry()
    await wait(200)
    await rm(join(cfg, "jobs", "ab12", "state.json"), { force: true })
    await wait(POLL_WAIT_MS)
    expect(api.getOne("ab12")?.short).toBe("ab12")
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
    expect(api.getOne("ab12")?.short).toBe("ab12")
  })

  it("publishes session.removed and stops tracking when a worker leaves the roster", async () => {
    await writeRoster(cfg, { ab12: {} })
    const api = await startRegistry()
    const events = recordSse((e) => e.type === "session.removed")
    await writeRoster(cfg, {})
    await wait(POLL_WAIT_MS)
    expect(events).toEqual([{ type: "session.removed", data: { short: "ab12" } }])
    expect(api.getOne("ab12")).toBeUndefined()
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
    expect(api.getOne("ab12")?.state).toBe("done")
    expect(api.getOne("ab12")?.detail).toBe("PR merged")
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
    expect(api.getOne("ab12")?.state).toBe("working")
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
    expect(api.getOne("ab12")?.state).toBe("working")
  })
})
