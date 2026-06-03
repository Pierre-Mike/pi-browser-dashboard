import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect, Layer, ManagedRuntime } from "effect"
import { ShellError, ShellRepo, type ShellRepoApi } from "../../platform/shell.repo"
import { FilesError, FilesService, type FilesServiceApi, type WorktreeDiff } from "./files.repo"
import { SessionRegistry, type SessionRegistryApi } from "./sessions.repo"
import { buildSessionsApp } from "./sessions.routes"

type SessionState = ReturnType<SessionRegistryApi["snapshot"]>[number]

const makeSession = (overrides: Partial<SessionState> = {}): SessionState => ({
  short: "ab12",
  state: "working",
  detail: undefined,
  tempo: undefined,
  intent: undefined,
  name: undefined,
  sessionId: undefined,
  cwd: undefined,
  createdAt: undefined,
  updatedAt: undefined,
  linkScanPath: undefined,
  worktreePath: undefined,
  worktreeBranch: undefined,
  result: undefined,
  ...overrides,
})

type ShellSpy = {
  readonly calls: Array<{ op: "stop" | "rm" | "peek" | "send"; id: string; keys?: string }>
  failNext: { op: "stop" | "rm" | "peek" | "send" } | null
  peekReturn: string
}

const buildShellLayer = (spy: ShellSpy): Layer.Layer<ShellRepo> => {
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
  return Layer.succeed(ShellRepo, api)
}

const buildRegistryLayer = (sessions: Map<string, SessionState>): Layer.Layer<SessionRegistry> =>
  Layer.succeed(SessionRegistry, {
    snapshot: () => Array.from(sessions.values()),
    getOne: (short) => sessions.get(short),
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

const buildHarness = ({
  sessions,
  spy,
  filesStub = newFilesStub(),
}: {
  sessions: Map<string, SessionState>
  spy: ShellSpy
  filesStub?: FilesStub
}) => {
  const layer = Layer.mergeAll(
    buildRegistryLayer(sessions),
    buildShellLayer(spy),
    buildFilesLayer(filesStub),
  )
  const runtime = ManagedRuntime.make(layer)
  const app = buildSessionsApp(runtime)
  return { app, runtime, filesStub, dispose: () => runtime.dispose() }
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
    const { app, dispose } = buildHarness({ sessions: new Map(), spy: newSpy() })
    try {
      const res = await app.request("/missing")
      expect(res.status).toBe(404)
      expect(await res.json()).toEqual({ error: "not_found", short: "missing" })
    } finally {
      await dispose()
    }
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

  it("returns 404 not_found when the session is unknown", async () => {
    const { app, dispose } = buildHarness({ sessions: new Map(), spy: newSpy() })
    try {
      const res = await app.request("/missing/transcript")
      expect(res.status).toBe(404)
      expect(await res.json()).toEqual({ error: "not_found", short: "missing" })
    } finally {
      await dispose()
    }
  })

  it("returns 404 no_transcript when linkScanPath is absent", async () => {
    const sessions = new Map([["ab12", makeSession({ short: "ab12", linkScanPath: undefined })]])
    const { app, dispose } = buildHarness({ sessions, spy: newSpy() })
    try {
      const res = await app.request("/ab12/transcript")
      expect(res.status).toBe(404)
      expect(await res.json()).toEqual({ error: "no_transcript", short: "ab12" })
    } finally {
      await dispose()
    }
  })

  it("returns 404 transcript_read_failed (ENOENT) when the file is missing", async () => {
    const missing = join(scratch, "nope.jsonl")
    const sessions = new Map([["ab12", makeSession({ short: "ab12", linkScanPath: missing })]])
    const { app, dispose } = buildHarness({ sessions, spy: newSpy() })
    try {
      const res = await app.request("/ab12/transcript")
      expect(res.status).toBe(404)
      const body = (await res.json()) as { error: string; code: string }
      expect(body.error).toBe("transcript_read_failed")
      expect(body.code).toBe("ENOENT")
    } finally {
      await dispose()
    }
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
    const sessions = new Map([["ab12", makeSession({ short: "ab12", linkScanPath: file })]])
    const { app, dispose } = buildHarness({ sessions, spy: newSpy() })
    try {
      const res = await app.request("/ab12/transcript")
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
    } finally {
      await dispose()
    }
  })

  it("surfaces unparseable lines as { _parseError: true, raw }", async () => {
    const file = join(scratch, "broken.jsonl")
    await writeFile(file, ["{not json", JSON.stringify({ ok: true })].join("\n"))
    const sessions = new Map([["ab12", makeSession({ short: "ab12", linkScanPath: file })]])
    const { app, dispose } = buildHarness({ sessions, spy: newSpy() })
    try {
      const res = await app.request("/ab12/transcript")
      expect(res.status).toBe(200)
      const body = (await res.json()) as {
        messages: Array<{ _parseError?: boolean; raw?: string; ok?: boolean }>
      }
      expect(body.messages[0]).toEqual({ _parseError: true, raw: "{not json" })
      expect(body.messages[1]?.ok).toBe(true)
    } finally {
      await dispose()
    }
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
    const { app, dispose } = buildHarness({ sessions: new Map(), spy: newSpy() })
    try {
      const res = await app.request("/missing/files")
      expect(res.status).toBe(404)
      expect(await res.json()).toEqual({ error: "not_found", short: "missing" })
    } finally {
      await dispose()
    }
  })

  it("returns an empty diff payload for non-isolated sessions (no worktreePath)", async () => {
    const sessions = new Map([["ab12", makeSession({ short: "ab12", worktreePath: undefined })]])
    const { app, dispose } = buildHarness({ sessions, spy: newSpy() })
    try {
      const res = await app.request("/ab12/files")
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({
        short: "ab12",
        changed: false,
        files: [],
        diff: "",
        truncated: false,
        base: null,
        worktreePath: null,
      })
    } finally {
      await dispose()
    }
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
  it("invokes ShellRepo.stop and returns ok", async () => {
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
  it("invokes ShellRepo.rm and returns ok", async () => {
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
})

describe("POST /sessions/:id/send", () => {
  const post = async ({
    app,
    id,
    body,
  }: {
    app: ReturnType<typeof buildSessionsApp>
    id: string
    body: unknown
  }): Promise<Response> =>
    app.request(`/${id}/send`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    })

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

  it("forwards keys to ShellRepo.send and returns ok", async () => {
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
})
