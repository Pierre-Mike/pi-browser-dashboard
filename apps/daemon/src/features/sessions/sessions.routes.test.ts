import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect, Layer, ManagedRuntime } from "effect"
import { ShellError, ShellIo, type ShellRepoApi } from "../../platform/shell.io"
import { type PiSessionsApi, PiSessionsIo } from "../dispatch/pi-sessions.io"
import { FilesError, FilesService, type FilesServiceApi, type WorktreeDiff } from "./files.io"
import { SessionRegistry, type SessionRegistryApi } from "./sessions.io"
import { buildSessionsApp } from "./sessions.routes"
import { makeSessionState as makeSession } from "./sessions.testFixtures"
import { type SessionWaitApi, SessionWaitIo, type WaitOutcome } from "./sessions-wait.io"

type SessionState = Awaited<ReturnType<SessionRegistryApi["snapshot"]>>[number]

type ShellSpy = {
  readonly calls: Array<{ op: "stop" | "rm" | "peek" | "send"; id: string; keys?: string }>
  failNext: { op: "stop" | "rm" | "peek" | "send" } | null
  peekReturn: string
}

const buildShellLayer = (spy: ShellSpy): Layer.Layer<ShellIo> => {
  const record = ({
    op,
    id,
    keys,
  }: {
    op: "stop" | "rm" | "peek" | "send"
    id: string
    keys?: string
  }) => {
    spy.calls.push(keys === undefined ? { op, id } : { op, id, keys })
  }
  const failIfRequested = (
    op: "stop" | "rm" | "peek" | "send",
  ): Effect.Effect<never, ShellError, never> | null => {
    if (spy.failNext?.op === op) {
      spy.failNext = null
      return Effect.fail(new ShellError({ message: `synthetic ${op} failure` }))
    }
    return null
  }
  const api: ShellRepoApi = {
    dispatch: () => Effect.fail(new ShellError({ message: "dispatch not used in this test" })),
    stop: (id) => {
      record({ op: "stop", id })
      return failIfRequested("stop") ?? Effect.void
    },
    rm: (id) => {
      record({ op: "rm", id })
      return failIfRequested("rm") ?? Effect.void
    },
    peek: (id) => {
      record({ op: "peek", id })
      return failIfRequested("peek") ?? Effect.succeed(spy.peekReturn)
    },
    send: ({ id, keys }) => {
      record({ op: "send", id, keys })
      return failIfRequested("send") ?? Effect.void
    },
  }
  return Layer.succeed(ShellIo, api)
}

// Per-short overrides for the diagnostics a real registry would compute from
// disk/pid probes — explain-route tests set these directly instead of faking
// a filesystem; anything omitted falls back to "everything is fine".
type DiagnosticsStub = {
  readonly updatedAtMs?: number | undefined
  readonly lastEventAtMs?: number | undefined
  readonly pidAlive?: boolean | undefined
  readonly stateFilePresent?: boolean
}

const DIAGNOSTICS_STUB_DEFAULTS: {
  readonly updatedAtMs: number | undefined
  readonly lastEventAtMs: number | undefined
  readonly pidAlive: boolean | undefined
  readonly stateFilePresent: boolean
} = {
  updatedAtMs: undefined,
  lastEventAtMs: undefined,
  pidAlive: true,
  stateFilePresent: true,
}

const buildRegistryLayer = (
  sessions: Map<string, SessionState>,
  diagnosticsOverrides: Map<string, DiagnosticsStub> = new Map(),
): Layer.Layer<SessionRegistry> =>
  Layer.succeed(SessionRegistry, {
    snapshot: () => Promise.resolve(Array.from(sessions.values())),
    getOne: (short) => Promise.resolve(sessions.get(short)),
    diagnostics: (short) => {
      const session = sessions.get(short)
      if (!session) return Promise.resolve(undefined)
      const override = { ...DIAGNOSTICS_STUB_DEFAULTS, ...diagnosticsOverrides.get(short) }
      return Promise.resolve({
        session,
        ...override,
        updatedAtMs: override.updatedAtMs ?? Date.parse(session.updatedAt ?? ""),
      })
    },
  })

type FilesStub = {
  readonly diffByPath: Map<string, WorktreeDiff>
  failWith?: FilesError
}

const buildFilesLayer = (stub: FilesStub): Layer.Layer<FilesService> => {
  const api: FilesServiceApi = {
    diffWorktree: (worktreePath) => {
      if (stub.failWith) return Effect.fail(stub.failWith)
      const diff = stub.diffByPath.get(worktreePath)
      if (!diff) return Effect.fail(new FilesError({ reason: "not_a_worktree" }))
      return Effect.succeed(diff)
    },
  }
  return Layer.succeed(FilesService, api)
}

const newSpy = (): ShellSpy => ({ calls: [], failNext: null, peekReturn: "" })

const newFilesStub = (): FilesStub => ({ diffByPath: new Map(), failWith: undefined })

// In-memory PiSessionsIo stub: pi sessions are keyed by short, remove()
// records what it dropped so tests can assert the pi rm branch fired.
type PiStub = {
  readonly sessions: Map<string, SessionState>
  readonly removed: string[]
}

const newPiStub = (): PiStub => ({ sessions: new Map(), removed: [] })

const buildPiSessionsLayer = (stub: PiStub): Layer.Layer<PiSessionsIo> => {
  const api: PiSessionsApi = {
    config: { spawnsFile: "", sessionsRoot: "", isPidAlive: () => false },
    record: () => {},
    list: () => Array.from(stub.sessions.values()),
    remove: (short) => {
      if (!stub.sessions.has(short)) return false
      stub.sessions.delete(short)
      stub.removed.push(short)
      return true
    },
    getOne: (short) => stub.sessions.get(short),
  }
  return Layer.succeed(PiSessionsIo, api)
}

// In-memory SessionWaitIo stub: records every call (and, for the send+wait
// ordering test, whether the ShellIo spy already saw a "send" by the time
// wait() fired) and always resolves with `outcome`.
type WaitSpy = {
  readonly calls: Array<{
    readonly short: string
    readonly until: readonly string[]
    readonly timeoutMs: number
    readonly pinnedSessionId: string | undefined
    readonly sawSendFirst: boolean
  }>
  outcome: WaitOutcome
}

const newWaitSpy = (): WaitSpy => ({
  calls: [],
  outcome: { _tag: "Satisfied", state: "done", waitedMs: 0 },
})

const buildWaitLayer = ({
  spy,
  shellSpy,
}: {
  spy: WaitSpy
  shellSpy: ShellSpy
}): Layer.Layer<SessionWaitIo> => {
  const api: SessionWaitApi = {
    wait: ({ short, request, pinnedSessionId }) => {
      spy.calls.push({
        short,
        until: request.until,
        timeoutMs: request.timeoutMs,
        pinnedSessionId,
        sawSendFirst: shellSpy.calls.some((c) => c.op === "send"),
      })
      return Effect.succeed(spy.outcome)
    },
  }
  return Layer.succeed(SessionWaitIo, api)
}

const buildHarness = ({
  sessions,
  spy,
  filesStub = newFilesStub(),
  piStub = newPiStub(),
  waitStub = newWaitSpy(),
  diagnosticsOverrides,
}: {
  sessions: Map<string, SessionState>
  spy: ShellSpy
  filesStub?: FilesStub
  piStub?: PiStub
  waitStub?: WaitSpy
  diagnosticsOverrides?: Map<string, DiagnosticsStub>
}) => {
  const layer = Layer.mergeAll(
    buildRegistryLayer(sessions, diagnosticsOverrides),
    buildShellLayer(spy),
    buildFilesLayer(filesStub),
    buildPiSessionsLayer(piStub),
    buildWaitLayer({ spy: waitStub, shellSpy: spy }),
  )
  const runtime = ManagedRuntime.make(layer)
  const app = buildSessionsApp(runtime)
  return { app, runtime, filesStub, piStub, waitStub, dispose: () => runtime.dispose() }
}

// The shape nearly every route test repeats: build a harness, issue one
// request, always dispose. The Response is fully materialized by app.request,
// so callers can read the body after disposal.
const requestOn = async ({
  path,
  init,
  sessions = new Map<string, SessionState>(),
  spy,
  filesStub,
  piStub,
  waitStub,
  diagnosticsOverrides,
}: {
  path: string
  init?: RequestInit
  sessions?: Map<string, SessionState>
  spy?: ShellSpy
  filesStub?: FilesStub
  piStub?: PiStub
  waitStub?: WaitSpy
  diagnosticsOverrides?: Map<string, DiagnosticsStub>
}): Promise<Response> => {
  const { app, dispose } = buildHarness({
    sessions,
    spy: spy ?? newSpy(),
    filesStub,
    piStub,
    waitStub,
    diagnosticsOverrides,
  })
  try {
    return await app.request(path, init)
  } finally {
    await dispose()
  }
}

const expectJson = async (
  res: Response,
  { status, body }: { status: number; body: unknown },
): Promise<void> => {
  expect(res.status).toBe(status)
  expect(await res.json()).toEqual(body)
}

const oneSession = (overrides: Partial<SessionState>): Map<string, SessionState> =>
  new Map([["ab12", makeSession({ short: "ab12", ...overrides })]])

type PostArgs = { app: ReturnType<typeof buildSessionsApp>; id: string; body: unknown }

// Shared "POST a JSON (or raw-string) body" request builder behind POST
// /:id/send, /:id/keys and /:id/wait below — each of those suites wraps this
// with its own endpoint name so call sites stay `post({ app, id, body })`
// while only one place knows how a body actually gets encoded onto the wire.
const postJson = async ({
  app,
  path,
  body,
}: {
  app: ReturnType<typeof buildSessionsApp>
  path: string
  body: unknown
}): Promise<Response> =>
  app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  })

// Shared assertion for "malformed request → 400 bad_request, nothing sent" —
// recurs across POST /:id/send and POST /:id/keys wherever a validation
// failure (bad keys/sequence, or a bad `wait`) must short-circuit before any
// bytes reach ShellIo. `waitStub` is only passed by the wait-validation cases.
const expectRejectedBeforeSend = async ({
  res,
  spy,
  waitStub,
}: {
  res: Response
  spy: ShellSpy
  waitStub?: WaitSpy
}): Promise<void> => {
  expect(res.status).toBe(400)
  const body = (await res.json()) as { error: string }
  expect(body.error).toBe("bad_request")
  expect(spy.calls).toEqual([])
  if (waitStub) expect(waitStub.calls).toEqual([])
}

describe("GET /sessions", () => {
  it("returns the registry snapshot as JSON", async () => {
    const sessions = new Map<string, SessionState>([
      ["ab12", makeSession({ short: "ab12", state: "working" })],
      ["cd34", makeSession({ short: "cd34", state: "idle" })],
    ])
    const { app, dispose } = buildHarness({ sessions, spy: newSpy() })
    try {
      const res = await app.request("/")
      expect(res.status).toBe(200)
      const body = (await res.json()) as Array<{ short: string; state: string }>
      expect(body.map((s) => s.short).sort()).toEqual(["ab12", "cd34"])
    } finally {
      await dispose()
    }
  })

  it("returns an empty array when the registry is empty", async () => {
    const { app, dispose } = buildHarness({ sessions: new Map(), spy: newSpy() })
    try {
      const res = await app.request("/")
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual([])
    } finally {
      await dispose()
    }
  })

  it("merges daemon-spawned pi sessions into the list", async () => {
    const sessions = new Map([["ab12", makeSession({ short: "ab12", state: "working" })]])
    const piStub = newPiStub()
    piStub.sessions.set(
      "aaaa1111",
      makeSession({ short: "aaaa1111", state: "done", harness: "pi" }),
    )
    const { app, dispose } = buildHarness({ sessions, spy: newSpy(), piStub })
    try {
      const res = await app.request("/")
      const body = (await res.json()) as Array<{ short: string; harness?: string }>
      expect(body.map((s) => s.short).sort()).toEqual(["aaaa1111", "ab12"])
      expect(body.find((s) => s.short === "aaaa1111")?.harness).toBe("pi")
    } finally {
      await dispose()
    }
  })
})

describe("GET /sessions/:id", () => {
  it("returns the single session JSON when the id is known", async () => {
    const sessions = new Map([["ab12", makeSession({ short: "ab12", state: "needs_input" })]])
    const { app, dispose } = buildHarness({ sessions, spy: newSpy() })
    try {
      const res = await app.request("/ab12")
      expect(res.status).toBe(200)
      const body = (await res.json()) as { short: string; state: string }
      expect(body.short).toBe("ab12")
      expect(body.state).toBe("needs_input")
    } finally {
      await dispose()
    }
  })

  it("returns 404 + structured error for an unknown id", async () => {
    const res = await requestOn({ path: "/missing" })
    await expectJson(res, { status: 404, body: { error: "not_found", short: "missing" } })
  })

  it("falls back to pi sessions when the registry misses", async () => {
    const piStub = newPiStub()
    piStub.sessions.set(
      "aaaa1111",
      makeSession({ short: "aaaa1111", state: "done", harness: "pi" }),
    )
    const res = await requestOn({ path: "/aaaa1111", piStub })
    expect(res.status).toBe(200)
    expect(((await res.json()) as { harness?: string }).harness).toBe("pi")
  })
})

describe("GET /sessions/:id/explain", () => {
  it("explains a healthy session with 200", async () => {
    const sessions = oneSession({ state: "working", updatedAt: new Date().toISOString() })
    const res = await requestOn({ path: "/ab12/explain", sessions })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      short: string
      state: string
      source: string
      stale: boolean
      reasons: string[]
    }
    expect(body.short).toBe("ab12")
    expect(body.state).toBe("working")
    expect(body.source).toBe("state.json")
    expect(body.stale).toBe(false)
    expect(body.reasons.length).toBeGreaterThanOrEqual(1)
  })

  it("returns 404 + structured error for an unknown id", async () => {
    const res = await requestOn({ path: "/missing/explain" })
    await expectJson(res, { status: 404, body: { error: "not_found", short: "missing" } })
  })

  it("reports stale:true for a working session whose state.json has gone quiet", async () => {
    const staleUpdatedAt = new Date(Date.now() - 200_000).toISOString()
    const sessions = oneSession({ state: "working", updatedAt: staleUpdatedAt })
    const res = await requestOn({ path: "/ab12/explain", sessions })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { stale: boolean; reasons: string[] }
    expect(body.stale).toBe(true)
    expect(body.reasons.some((r) => r.toLowerCase().includes("stale"))).toBe(true)
  })

  it("surfaces degradedFrom and a dead pid in the reasons", async () => {
    const sessions = oneSession({ state: "unknown", degradedFrom: "supervisor-v3" })
    const diagnosticsOverrides = new Map([["ab12", { pidAlive: false, stateFilePresent: true }]])
    const res = await requestOn({ path: "/ab12/explain", sessions, diagnosticsOverrides })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { degradedFrom: string; reasons: string[] }
    expect(body.degradedFrom).toBe("supervisor-v3")
    expect(body.reasons.some((r) => r.includes("supervisor-v3"))).toBe(true)
    expect(body.reasons.some((r) => r.includes("respawn"))).toBe(true)
  })

  // Deliberate, not incidental: unlike GET /:id, this route never falls back
  // to PiSessionsIo — diagnostics() only knows the claude SessionRegistry, so
  // a pi short 404s here even though it lists and GETs fine. Documented gap;
  // a pi-aware explain (reading its own spawn log's "pi-spawn-log" source) is
  // a follow-up, not something this test should silently mask.
  it("404s for a pi session — diagnostics has no pi-registry fallback (documented gap)", async () => {
    const piStub = newPiStub()
    piStub.sessions.set(
      "aaaa1111",
      makeSession({ short: "aaaa1111", state: "working", source: "pi-spawn-log", harness: "pi" }),
    )
    const res = await requestOn({ path: "/aaaa1111/explain", piStub })
    await expectJson(res, { status: 404, body: { error: "not_found", short: "aaaa1111" } })
  })
})

describe("GET /sessions/:id/transcript", () => {
  let scratch: string
  beforeEach(async () => {
    scratch = await mkdtemp(join(tmpdir(), "pid-sessions-routes-"))
  })
  afterEach(async () => {
    await rm(scratch, { recursive: true, force: true })
  })

  // One transcript request against a session whose linkScanPath points at
  // `file` — the setup every test in this describe shares.
  const transcriptRes = (file: string | undefined): Promise<Response> =>
    requestOn({ path: "/ab12/transcript", sessions: oneSession({ linkScanPath: file }) })

  it("returns 404 not_found when the session is unknown", async () => {
    const res = await requestOn({ path: "/missing/transcript" })
    await expectJson(res, { status: 404, body: { error: "not_found", short: "missing" } })
  })

  it("returns 404 no_transcript when linkScanPath is absent", async () => {
    const res = await transcriptRes(undefined)
    await expectJson(res, { status: 404, body: { error: "no_transcript", short: "ab12" } })
  })

  it("returns 404 transcript_read_failed (ENOENT) when the file is missing", async () => {
    const res = await transcriptRes(join(scratch, "nope.jsonl"))
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: string; code: string }
    expect(body.error).toBe("transcript_read_failed")
    expect(body.code).toBe("ENOENT")
  })

  it("parses each JSONL line and reports truncated=false when within the cap", async () => {
    const file = join(scratch, "t.jsonl")
    await writeFile(
      file,
      `${[
        JSON.stringify({ type: "user", text: "hi" }),
        JSON.stringify({ type: "assistant", text: "hello" }),
      ].join("\n")}\n`,
    )
    const res = await transcriptRes(file)
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      messages: Array<{ type?: string; _parseError?: boolean; raw?: string }>
      truncated: boolean
      path: string
    }
    expect(body.messages).toHaveLength(2)
    expect(body.messages[0]?.type).toBe("user")
    expect(body.messages[1]?.type).toBe("assistant")
    expect(body.truncated).toBe(false)
    expect(body.path).toBe(file)
  })

  it("surfaces unparseable lines as { _parseError: true, raw }", async () => {
    const file = join(scratch, "broken.jsonl")
    await writeFile(file, ["{not json", JSON.stringify({ ok: true })].join("\n"))
    const res = await transcriptRes(file)
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      messages: Array<{ _parseError?: boolean; raw?: string; ok?: boolean }>
    }
    expect(body.messages[0]).toEqual({ _parseError: true, raw: "{not json" })
    expect(body.messages[1]?.ok).toBe(true)
  })

  it("caps and tail-slices the transcript at 500 lines, flagging truncated=true", async () => {
    const file = join(scratch, "huge.jsonl")
    const lines: string[] = []
    for (let i = 0; i < 750; i++) lines.push(JSON.stringify({ i }))
    await mkdir(scratch, { recursive: true })
    await writeFile(file, lines.join("\n"))
    const sessions = new Map([["ab12", makeSession({ short: "ab12", linkScanPath: file })]])
    const { app, dispose } = buildHarness({ sessions, spy: newSpy() })
    try {
      const res = await app.request("/ab12/transcript")
      const body = (await res.json()) as {
        messages: Array<{ i: number }>
        truncated: boolean
      }
      expect(body.truncated).toBe(true)
      expect(body.messages).toHaveLength(500)
      // Tail slice: last entry is i=749.
      expect(body.messages[body.messages.length - 1]?.i).toBe(749)
    } finally {
      await dispose()
    }
  })
})

describe("GET /sessions/:id/files", () => {
  it("returns 404 not_found when the session is unknown", async () => {
    const res = await requestOn({ path: "/missing/files" })
    await expectJson(res, { status: 404, body: { error: "not_found", short: "missing" } })
  })

  it("returns an empty diff payload for non-isolated sessions (no worktreePath)", async () => {
    const res = await requestOn({
      path: "/ab12/files",
      sessions: oneSession({ worktreePath: undefined }),
    })
    await expectJson(res, {
      status: 200,
      body: {
        short: "ab12",
        changed: false,
        files: [],
        diff: "",
        truncated: false,
        base: null,
        worktreePath: null,
      },
    })
  })

  it("returns the FilesService diff payload when the worktree resolves", async () => {
    const wt = "/tmp/.claude/worktrees/feature-x"
    const sessions = new Map([["ab12", makeSession({ short: "ab12", worktreePath: wt })]])
    const filesStub = newFilesStub()
    filesStub.diffByPath.set(wt, {
      worktreePath: wt,
      base: "origin/main",
      files: [{ path: "src/a.ts", status: "modified" }],
      diff: "diff --git a/src/a.ts b/src/a.ts\n+x\n",
      truncated: false,
      changed: true,
    })
    const { app, dispose } = buildHarness({
      sessions,
      spy: newSpy(),
      filesStub: filesStub,
    })
    try {
      const res = await app.request("/ab12/files")
      expect(res.status).toBe(200)
      const body = (await res.json()) as {
        short: string
        base: string
        files: Array<{ path: string; status: string }>
        diff: string
        truncated: boolean
        changed: boolean
      }
      expect(body.short).toBe("ab12")
      expect(body.base).toBe("origin/main")
      expect(body.changed).toBe(true)
      expect(body.files).toEqual([{ path: "src/a.ts", status: "modified" }])
      expect(body.diff).toContain("diff --git")
    } finally {
      await dispose()
    }
  })

  it("returns 500 diff_failed when the FilesService rejects", async () => {
    const wt = "/tmp/.claude/worktrees/broken"
    const sessions = new Map([["ab12", makeSession({ short: "ab12", worktreePath: wt })]])
    const filesStub = newFilesStub()
    filesStub.failWith = new FilesError({ reason: "no_base_ref" })
    const { app, dispose } = buildHarness({
      sessions,
      spy: newSpy(),
      filesStub: filesStub,
    })
    try {
      const res = await app.request("/ab12/files")
      expect(res.status).toBe(500)
      const body = (await res.json()) as { error: string; short: string; reason?: string }
      expect(body.error).toBe("diff_failed")
      expect(body.short).toBe("ab12")
      expect(body.reason).toBe("no_base_ref")
    } finally {
      await dispose()
    }
  })
})

describe("POST /sessions/:id/stop", () => {
  it("invokes ShellIo.stop and returns ok", async () => {
    const spy = newSpy()
    const { app, dispose } = buildHarness({ sessions: new Map(), spy: spy })
    try {
      const res = await app.request("/ab12/stop", { method: "POST" })
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ ok: true, short: "ab12" })
      expect(spy.calls).toEqual([{ op: "stop", id: "ab12" }])
    } finally {
      await dispose()
    }
  })

  it("returns 500 stop_failed when the shell call rejects", async () => {
    const spy = newSpy()
    spy.failNext = { op: "stop" }
    const { app, dispose } = buildHarness({ sessions: new Map(), spy: spy })
    try {
      const res = await app.request("/ab12/stop", { method: "POST" })
      expect(res.status).toBe(500)
      expect(await res.json()).toEqual({ error: "stop_failed", short: "ab12" })
    } finally {
      await dispose()
    }
  })
})

describe("POST /sessions/:id/peek", () => {
  it("returns the peek summary on success", async () => {
    const spy = newSpy()
    spy.peekReturn = "all green"
    const { app, dispose } = buildHarness({ sessions: new Map(), spy: spy })
    try {
      const res = await app.request("/ab12/peek", { method: "POST" })
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ short: "ab12", summary: "all green" })
      expect(spy.calls).toEqual([{ op: "peek", id: "ab12" }])
    } finally {
      await dispose()
    }
  })

  it("returns 500 peek_failed on shell failure", async () => {
    const spy = newSpy()
    spy.failNext = { op: "peek" }
    const { app, dispose } = buildHarness({ sessions: new Map(), spy: spy })
    try {
      const res = await app.request("/ab12/peek", { method: "POST" })
      expect(res.status).toBe(500)
      expect(await res.json()).toEqual({ error: "peek_failed", short: "ab12" })
    } finally {
      await dispose()
    }
  })
})

describe("POST /sessions/:id/rm", () => {
  it("invokes ShellIo.rm and returns ok", async () => {
    const spy = newSpy()
    const { app, dispose } = buildHarness({ sessions: new Map(), spy: spy })
    try {
      const res = await app.request("/ab12/rm", { method: "POST" })
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ ok: true, short: "ab12" })
      expect(spy.calls).toEqual([{ op: "rm", id: "ab12" }])
    } finally {
      await dispose()
    }
  })

  it("returns 500 rm_failed on shell failure", async () => {
    const spy = newSpy()
    spy.failNext = { op: "rm" }
    const { app, dispose } = buildHarness({ sessions: new Map(), spy: spy })
    try {
      const res = await app.request("/ab12/rm", { method: "POST" })
      expect(res.status).toBe(500)
      expect(await res.json()).toEqual({ error: "rm_failed", short: "ab12" })
    } finally {
      await dispose()
    }
  })

  it("removes a pi spawn from the pi log without shelling out to claude rm", async () => {
    const spy = newSpy()
    const piStub = newPiStub()
    piStub.sessions.set(
      "aaaa1111",
      makeSession({ short: "aaaa1111", state: "done", harness: "pi" }),
    )
    const { app, dispose } = buildHarness({ sessions: new Map(), spy, piStub })
    try {
      const res = await app.request("/aaaa1111/rm", { method: "POST" })
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ ok: true, short: "aaaa1111" })
      expect(piStub.removed).toEqual(["aaaa1111"])
      expect(spy.calls).toEqual([])
    } finally {
      await dispose()
    }
  })
})

describe("POST /sessions/:id/send", () => {
  const post = ({ app, id, body }: PostArgs): Promise<Response> =>
    postJson({ app, path: `/${id}/send`, body })

  it("rejects a missing keys field with 400 bad_keys", async () => {
    const { app, dispose } = buildHarness({ sessions: new Map(), spy: newSpy() })
    try {
      const res = await post({ app, id: "ab12", body: {} })
      expect(res.status).toBe(400)
      const body = (await res.json()) as { error: string }
      expect(body.error).toBe("bad_keys")
    } finally {
      await dispose()
    }
  })

  it("rejects an empty keys string with 400 bad_keys", async () => {
    const { app, dispose } = buildHarness({ sessions: new Map(), spy: newSpy() })
    try {
      const res = await post({ app, id: "ab12", body: { keys: "" } })
      expect(res.status).toBe(400)
    } finally {
      await dispose()
    }
  })

  it("rejects a non-string keys field with 400 bad_keys", async () => {
    const { app, dispose } = buildHarness({ sessions: new Map(), spy: newSpy() })
    try {
      const res = await post({ app, id: "ab12", body: { keys: 42 } })
      expect(res.status).toBe(400)
    } finally {
      await dispose()
    }
  })

  it("rejects a keys payload over 4096 bytes with 413 keys_too_long", async () => {
    const { app, dispose } = buildHarness({ sessions: new Map(), spy: newSpy() })
    try {
      const res = await post({ app, id: "ab12", body: { keys: "x".repeat(4097) } })
      expect(res.status).toBe(413)
      const body = (await res.json()) as { error: string }
      expect(body.error).toBe("keys_too_long")
    } finally {
      await dispose()
    }
  })

  it("accepts a keys payload at exactly the 4096-byte cap", async () => {
    const spy = newSpy()
    const { app, dispose } = buildHarness({ sessions: new Map(), spy: spy })
    try {
      const res = await post({ app, id: "ab12", body: { keys: "x".repeat(4096) } })
      expect(res.status).toBe(200)
      expect(spy.calls[0]?.op).toBe("send")
      expect((spy.calls[0] as { keys: string }).keys.length).toBe(4096)
    } finally {
      await dispose()
    }
  })

  it("forwards keys to ShellIo.send and returns ok", async () => {
    const spy = newSpy()
    const { app, dispose } = buildHarness({ sessions: new Map(), spy: spy })
    try {
      const res = await post({ app, id: "ab12", body: { keys: "hello\n" } })
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ ok: true, short: "ab12" })
      expect(spy.calls).toEqual([{ op: "send", id: "ab12", keys: "hello\n" }])
    } finally {
      await dispose()
    }
  })

  it("returns 500 send_failed on shell failure", async () => {
    const spy = newSpy()
    spy.failNext = { op: "send" }
    const { app, dispose } = buildHarness({ sessions: new Map(), spy: spy })
    try {
      const res = await post({ app, id: "ab12", body: { keys: "x" } })
      expect(res.status).toBe(500)
      expect(await res.json()).toEqual({ error: "send_failed", short: "ab12" })
    } finally {
      await dispose()
    }
  })

  it("tolerates a non-JSON body and returns 400 bad_keys (no crash)", async () => {
    const { app, dispose } = buildHarness({ sessions: new Map(), spy: newSpy() })
    try {
      const res = await post({ app, id: "ab12", body: "not-json-at-all" })
      expect(res.status).toBe(400)
    } finally {
      await dispose()
    }
  })

  it("sends the keys before resolving the wait", async () => {
    const spy = newSpy()
    const waitStub = newWaitSpy()
    const { app, dispose } = buildHarness({ sessions: new Map(), spy, waitStub })
    try {
      const res = await post({
        app,
        id: "ab12",
        body: { keys: "hello\n", wait: { until: ["done"] } },
      })
      expect(res.status).toBe(200)
      expect(spy.calls).toEqual([{ op: "send", id: "ab12", keys: "hello\n" }])
      expect(waitStub.calls).toHaveLength(1)
      expect(waitStub.calls[0]?.sawSendFirst).toBe(true)
    } finally {
      await dispose()
    }
  })

  it("embeds the wait outcome, pinned to the sessionId observed before sending", async () => {
    const spy = newSpy()
    const waitStub = newWaitSpy()
    waitStub.outcome = { _tag: "Timeout", waitedMs: 1_234 }
    const sessions = oneSession({ sessionId: "sess-1" })
    const { app, dispose } = buildHarness({ sessions, spy, waitStub })
    try {
      const res = await post({
        app,
        id: "ab12",
        body: { keys: "hello\n", wait: { until: ["done"], timeoutMs: 5_000 } },
      })
      expect(res.status).toBe(200)
      await expectJson(res, {
        status: 200,
        body: {
          ok: true,
          short: "ab12",
          wait: { ok: false, reason: "timeout", short: "ab12", waitedMs: 1_234 },
        },
      })
      expect(waitStub.calls[0]).toMatchObject({
        short: "ab12",
        until: ["done"],
        timeoutMs: 5_000,
        pinnedSessionId: "sess-1",
      })
    } finally {
      await dispose()
    }
  })

  it("returns the unchanged { ok, short } shape when no wait is requested", async () => {
    const waitStub = newWaitSpy()
    const { app, dispose } = buildHarness({ sessions: new Map(), spy: newSpy(), waitStub })
    try {
      const res = await post({ app, id: "ab12", body: { keys: "hello\n" } })
      await expectJson(res, { status: 200, body: { ok: true, short: "ab12" } })
      expect(waitStub.calls).toEqual([])
    } finally {
      await dispose()
    }
  })

  it("rejects a malformed wait object with 400 before sending any keys", async () => {
    const spy = newSpy()
    const waitStub = newWaitSpy()
    const { app, dispose } = buildHarness({ sessions: new Map(), spy, waitStub })
    try {
      const res = await post({ app, id: "ab12", body: { keys: "hello\n", wait: { until: [] } } })
      await expectRejectedBeforeSend({ res, spy, waitStub })
    } finally {
      await dispose()
    }
  })
})

describe("POST /sessions/:id/keys", () => {
  const postKeys = ({ app, id, body }: PostArgs): Promise<Response> =>
    postJson({ app, path: `/${id}/keys`, body })

  it("forwards the resolved bytes to ShellIo.send and returns the trail", async () => {
    const spy = newSpy()
    const { app, dispose } = buildHarness({ sessions: new Map(), spy })
    try {
      const res = await postKeys({
        app,
        id: "ab12",
        body: { sequence: [{ named: "down", repeat: 2 }, { named: "enter" }] },
      })
      expect(res.status).toBe(200)
      expect(spy.calls).toEqual([{ op: "send", id: "ab12", keys: "\x1b[B\x1b[B\r" }])
      await expectJson(res, {
        status: 200,
        body: { ok: true, short: "ab12", resolved: ["down", "down", "enter"], bytes: 7 },
      })
    } finally {
      await dispose()
    }
  })

  it("rejects a malformed sequence with 400 and sends no bytes", async () => {
    const spy = newSpy()
    const { app, dispose } = buildHarness({ sessions: new Map(), spy })
    try {
      const res = await postKeys({ app, id: "ab12", body: { sequence: [] } })
      await expectRejectedBeforeSend({ res, spy })
    } finally {
      await dispose()
    }
  })

  it("rejects an unknown named key (e.g. ctrl-z) with 400 and sends no bytes", async () => {
    const spy = newSpy()
    const { app, dispose } = buildHarness({ sessions: new Map(), spy })
    try {
      const res = await postKeys({ app, id: "ab12", body: { sequence: [{ named: "ctrl-z" }] } })
      expect(res.status).toBe(400)
      expect(spy.calls).toEqual([])
    } finally {
      await dispose()
    }
  })

  it("rejects a malformed wait object with 400 before sending any keys", async () => {
    const spy = newSpy()
    const waitStub = newWaitSpy()
    const { app, dispose } = buildHarness({ sessions: new Map(), spy, waitStub })
    try {
      const res = await postKeys({
        app,
        id: "ab12",
        body: { sequence: [{ named: "enter" }], wait: { until: [] } },
      })
      await expectRejectedBeforeSend({ res, spy, waitStub })
    } finally {
      await dispose()
    }
  })

  it("sends the resolved keys, then embeds the wait outcome pinned to the pre-send occupant", async () => {
    const spy = newSpy()
    const waitStub = newWaitSpy()
    waitStub.outcome = { _tag: "Satisfied", state: "done", waitedMs: 12 }
    const sessions = oneSession({ sessionId: "sess-1" })
    const { app, dispose } = buildHarness({ sessions, spy, waitStub })
    try {
      const res = await postKeys({
        app,
        id: "ab12",
        body: { sequence: [{ named: "down" }, { named: "enter" }], wait: { until: ["done"] } },
      })
      expect(res.status).toBe(200)
      expect(spy.calls).toEqual([{ op: "send", id: "ab12", keys: "\x1b[B\r" }])
      expect(waitStub.calls[0]).toMatchObject({ short: "ab12", pinnedSessionId: "sess-1" })
      await expectJson(res, {
        status: 200,
        body: {
          ok: true,
          short: "ab12",
          resolved: ["down", "enter"],
          bytes: 4,
          wait: { ok: true, short: "ab12", state: "done", waitedMs: 12 },
        },
      })
    } finally {
      await dispose()
    }
  })

  it("returns 500 send_failed on shell failure", async () => {
    const spy = newSpy()
    spy.failNext = { op: "send" }
    const { app, dispose } = buildHarness({ sessions: new Map(), spy })
    try {
      const res = await postKeys({ app, id: "ab12", body: { sequence: [{ named: "enter" }] } })
      expect(res.status).toBe(500)
      expect(await res.json()).toEqual({ error: "send_failed", short: "ab12" })
    } finally {
      await dispose()
    }
  })
})

describe("POST /sessions/:id/wait", () => {
  const postWait = ({ app, id, body }: PostArgs): Promise<Response> =>
    postJson({ app, path: `/${id}/wait`, body })

  // Issues POST /:id/wait against a SessionWaitIo stub pinned to `outcome` —
  // the shape every outcome-mapping test below shares.
  const waitRes = ({ id, outcome }: { id: string; outcome: WaitOutcome }): Promise<Response> => {
    const waitStub = newWaitSpy()
    waitStub.outcome = outcome
    return requestOn({
      path: `/${id}/wait`,
      init: {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ until: ["done"] }),
      },
      waitStub,
    })
  }

  it("rejects a malformed body with 400 bad_request", async () => {
    const { app, dispose } = buildHarness({ sessions: new Map(), spy: newSpy() })
    try {
      const res = await postWait({ app, id: "ab12", body: { until: [] } })
      expect(res.status).toBe(400)
      const body = (await res.json()) as { error: string; message: string }
      expect(body.error).toBe("bad_request")
      expect(typeof body.message).toBe("string")
    } finally {
      await dispose()
    }
  })

  it("forwards the short and parsed until to SessionWaitIo.wait", async () => {
    const waitStub = newWaitSpy()
    const res = await requestOn({
      path: "/ab12/wait",
      init: {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ until: ["done", "failed"] }),
      },
      waitStub,
    })
    expect(res.status).toBe(200)
    expect(waitStub.calls[0]).toMatchObject({ short: "ab12", until: ["done", "failed"] })
  })

  it("returns 404 not_found when the wait service reports NotFound", async () => {
    const res = await waitRes({ id: "missing", outcome: { _tag: "NotFound" } })
    await expectJson(res, { status: 404, body: { error: "not_found", short: "missing" } })
  })

  it("returns 200 with the Satisfied payload", async () => {
    const res = await waitRes({
      id: "ab12",
      outcome: { _tag: "Satisfied", state: "done", waitedMs: 42 },
    })
    await expectJson(res, {
      status: 200,
      body: { ok: true, short: "ab12", state: "done", waitedMs: 42 },
    })
  })

  it("returns 200 with the OccupantChanged payload", async () => {
    const res = await waitRes({ id: "ab12", outcome: { _tag: "OccupantChanged" } })
    await expectJson(res, {
      status: 200,
      body: { ok: false, reason: "occupant_changed", short: "ab12" },
    })
  })

  it("returns 200 with the Removed payload", async () => {
    const res = await waitRes({ id: "ab12", outcome: { _tag: "Removed" } })
    await expectJson(res, { status: 200, body: { ok: false, reason: "removed", short: "ab12" } })
  })
})

describe("session file-browser routes", () => {
  let work: string
  beforeEach(async () => {
    work = await mkdtemp(join(tmpdir(), "pid-session-files-"))
    await mkdir(join(work, "src"), { recursive: true })
    await writeFile(join(work, "README.md"), "# hello\n")
    await writeFile(join(work, "src", "index.ts"), "export const x = 1\n")
  })
  afterEach(async () => {
    await rm(work, { recursive: true, force: true })
  })

  // One request against a session whose worktree is the scratch dir — the
  // setup every file-browser test shares.
  const workRes = (path: string): Promise<Response> =>
    requestOn({ path, sessions: oneSession({ worktreePath: work }) })

  describe("GET /:id/tree", () => {
    it("lists the worktree files, posix-relative and sorted", async () => {
      const res = await workRes("/ab12/tree")
      expect(res.status).toBe(200)
      const body = (await res.json()) as { paths: string[]; truncated: boolean }
      expect(body.paths).toEqual(["README.md", "src/index.ts"])
      expect(body.truncated).toBe(false)
    })

    it("falls back to cwd when worktreePath is absent", async () => {
      const res = await requestOn({
        path: "/ab12/tree",
        sessions: oneSession({ worktreePath: undefined, cwd: work }),
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as { paths: string[] }
      expect(body.paths).toContain("README.md")
    })

    it("adds gitStatus badges when ?gitStatus=1", async () => {
      const res = await workRes("/ab12/tree?gitStatus=1")
      expect(res.status).toBe(200)
      const body = (await res.json()) as { paths: string[]; gitStatus: unknown[] }
      // Non-git tmp dir → empty badge list, but the field must be present.
      expect(Array.isArray(body.gitStatus)).toBe(true)
    })

    it("omits gitStatus without the query flag", async () => {
      const res = await workRes("/ab12/tree")
      const body = (await res.json()) as Record<string, unknown>
      expect("gitStatus" in body).toBe(false)
    })

    it("returns 404 not_found for an unknown session", async () => {
      const res = await requestOn({ path: "/missing/tree" })
      await expectJson(res, { status: 404, body: { error: "not_found", short: "missing" } })
    })

    it("returns 404 no_worktree when the session has neither worktreePath nor cwd", async () => {
      const res = await requestOn({
        path: "/ab12/tree",
        sessions: oneSession({ worktreePath: undefined, cwd: undefined }),
      })
      await expectJson(res, { status: 404, body: { error: "no_worktree", short: "ab12" } })
    })
  })

  describe("GET /:id/file", () => {
    it("reads a text file under the worktree", async () => {
      const res = await workRes("/ab12/file?path=README.md")
      expect(res.status).toBe(200)
      const body = (await res.json()) as { content: string; isBinary: boolean }
      expect(body.content).toBe("# hello\n")
      expect(body.isBinary).toBe(false)
    })

    it("returns 400 missing_path when no path is given", async () => {
      const res = await workRes("/ab12/file")
      await expectJson(res, { status: 400, body: { error: "missing_path" } })
    })

    it("returns 403 forbidden on a parent-directory escape", async () => {
      const res = await workRes("/ab12/file?path=../etc/passwd")
      expect(res.status).toBe(403)
    })

    it("returns 404 not_found for an unknown session", async () => {
      const res = await requestOn({ path: "/missing/file?path=README.md" })
      await expectJson(res, { status: 404, body: { error: "not_found", short: "missing" } })
    })
  })

  describe("GET /:id/raw", () => {
    it("streams the file bytes with the right content-type", async () => {
      const res = await workRes("/ab12/raw?path=README.md")
      expect(res.status).toBe(200)
      expect(res.headers.get("Content-Type")).toContain("text/markdown")
      expect(await res.text()).toBe("# hello\n")
    })

    it("forces a download with Content-Disposition when ?download=1", async () => {
      const res = await workRes("/ab12/raw?path=README.md&download=1")
      expect(res.status).toBe(200)
      expect(res.headers.get("Content-Disposition")).toContain("attachment")
    })

    it("returns 400 missing_path when no path is given", async () => {
      const sessions = new Map([["ab12", makeSession({ short: "ab12", worktreePath: work })]])
      const { app, dispose } = buildHarness({ sessions, spy: newSpy() })
      try {
        const res = await app.request("/ab12/raw")
        expect(res.status).toBe(400)
      } finally {
        await dispose()
      }
    })
  })
})
