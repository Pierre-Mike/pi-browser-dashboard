import { describe, expect, it } from "bun:test"
import { Effect, Layer, ManagedRuntime } from "effect"
import {
  type DispatchInput,
  ShellError,
  ShellRepo,
  type ShellRepoApi,
} from "../../platform/shell.repo"
import { buildDispatchApp } from "./dispatch.routes"
import { type PiDispatchInput, PiRepo, type PiRepoApi } from "./pi.repo"

type Spy = {
  readonly calls: DispatchInput[]
  shortReturn: string
  failNext: boolean
  readonly piCalls: PiDispatchInput[]
  piReturn: string
  piFailNext: ShellError | null
  piModelsFailNext: boolean
}

const newSpy = (): Spy => ({
  calls: [],
  shortReturn: "abcd1234",
  failNext: false,
  piCalls: [],
  piReturn: "11111111-2222-3333-4444-555555555555",
  piFailNext: null,
  piModelsFailNext: false,
})

const buildShellLayer = (spy: Spy): Layer.Layer<ShellRepo> => {
  const api: ShellRepoApi = {
    dispatch: (input) => {
      spy.calls.push(input)
      if (spy.failNext) {
        spy.failNext = false
        return Effect.fail(new ShellError({ message: "synthetic failure" }))
      }
      return Effect.succeed(spy.shortReturn)
    },
    stop: () => Effect.fail(new ShellError({ message: "stop not used in this test" })),
    rm: () => Effect.fail(new ShellError({ message: "rm not used in this test" })),
    peek: () => Effect.fail(new ShellError({ message: "peek not used in this test" })),
    send: () => Effect.fail(new ShellError({ message: "send not used in this test" })),
  }
  return Layer.succeed(ShellRepo, api)
}

const buildPiLayer = (spy: Spy): Layer.Layer<PiRepo> => {
  const api: PiRepoApi = {
    dispatch: (input) => {
      spy.piCalls.push(input)
      if (spy.piFailNext) {
        const err = spy.piFailNext
        spy.piFailNext = null
        return Effect.fail(err)
      }
      return Effect.succeed(spy.piReturn)
    },
    listModels: () => {
      if (spy.piModelsFailNext) {
        spy.piModelsFailNext = false
        return Effect.fail(new ShellError({ message: "pi unavailable" }))
      }
      return Effect.succeed([
        { provider: "anthropic", id: "claude-sonnet-5" },
        { provider: "github-copilot", id: "gpt-5-mini" },
      ])
    },
  }
  return Layer.succeed(PiRepo, api)
}

const buildHarness = (spy: Spy) => {
  const runtime = ManagedRuntime.make(Layer.mergeAll(buildShellLayer(spy), buildPiLayer(spy)))
  return { app: buildDispatchApp(runtime), dispose: () => runtime.dispose() }
}

const post = (app: ReturnType<typeof buildDispatchApp>, body: unknown) =>
  app.request("/", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  })

describe("POST /dispatch", () => {
  it("returns the parsed short id on a happy-path dispatch", async () => {
    const spy = newSpy()
    spy.shortReturn = "xyz9"
    const { app, dispose } = buildHarness(spy)
    try {
      const res = await post(app, { intent: "fix bug", cwd: "/repo", agent: "reviewer" })
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ short: "xyz9" })
      expect(spy.calls).toEqual([
        {
          intent: "fix bug",
          cwd: "/repo",
          agent: "reviewer",
          permissionMode: undefined,
          effort: undefined,
        },
      ])
    } finally {
      await dispose()
    }
  })

  it("forwards permissionMode when provided", async () => {
    const spy = newSpy()
    const { app, dispose } = buildHarness(spy)
    try {
      await post(app, { intent: "go", permissionMode: "bypassPermissions" })
      expect(spy.calls[0]?.permissionMode).toBe("bypassPermissions")
    } finally {
      await dispose()
    }
  })

  it("forwards effort when provided", async () => {
    const spy = newSpy()
    const { app, dispose } = buildHarness(spy)
    try {
      await post(app, { intent: "go", effort: "high" })
      expect(spy.calls[0]?.effort).toBe("high")
    } finally {
      await dispose()
    }
  })

  it("forwards model when provided", async () => {
    const spy = newSpy()
    const { app, dispose } = buildHarness(spy)
    try {
      await post(app, { intent: "go", model: "opus" })
      expect(spy.calls[0]?.model).toBe("opus")
    } finally {
      await dispose()
    }
  })

  it("forwards a tools list when provided", async () => {
    const spy = newSpy()
    const { app, dispose } = buildHarness(spy)
    try {
      await post(app, { intent: "go", tools: ["Bash", "Edit"] })
      expect(spy.calls[0]?.tools).toEqual(["Bash", "Edit"])
    } finally {
      await dispose()
    }
  })

  it("forwards an explicit empty tools list (disable all tools)", async () => {
    const spy = newSpy()
    const { app, dispose } = buildHarness(spy)
    try {
      await post(app, { intent: "go", tools: [] })
      expect(spy.calls[0]?.tools).toEqual([])
    } finally {
      await dispose()
    }
  })

  it("ignores a malformed tools value rather than crashing", async () => {
    const spy = newSpy()
    const { app, dispose } = buildHarness(spy)
    try {
      const res = await post(app, { intent: "go", tools: ["Bash", 42] })
      expect(res.status).toBe(200)
      expect(spy.calls[0]?.tools).toBeUndefined()
    } finally {
      await dispose()
    }
  })

  it("rejects an empty body with 400 invalid_json", async () => {
    const { app, dispose } = buildHarness(newSpy())
    try {
      const res = await post(app, "not-json-at-all")
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: "invalid_json" })
    } finally {
      await dispose()
    }
  })

  it("rejects a missing intent with 400 missing_intent", async () => {
    const { app, dispose } = buildHarness(newSpy())
    try {
      const res = await post(app, { cwd: "/x" })
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: "missing_intent" })
    } finally {
      await dispose()
    }
  })

  it("rejects a whitespace-only intent with 400 missing_intent", async () => {
    const { app, dispose } = buildHarness(newSpy())
    try {
      const res = await post(app, { intent: "   " })
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: "missing_intent" })
    } finally {
      await dispose()
    }
  })

  it("rejects a non-string intent with 400 missing_intent", async () => {
    const { app, dispose } = buildHarness(newSpy())
    try {
      const res = await post(app, { intent: 42 })
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: "missing_intent" })
    } finally {
      await dispose()
    }
  })

  it("ignores non-string cwd/agent/permissionMode rather than crashing", async () => {
    const spy = newSpy()
    const { app, dispose } = buildHarness(spy)
    try {
      const res = await post(app, {
        intent: "go",
        cwd: 1,
        agent: { not: "a string" },
        permissionMode: true,
      })
      expect(res.status).toBe(200)
      expect(spy.calls[0]).toEqual({
        intent: "go",
        cwd: undefined,
        agent: undefined,
        permissionMode: undefined,
        effort: undefined,
      })
    } finally {
      await dispose()
    }
  })

  it("returns 500 dispatch_failed with the failure detail when ShellRepo.dispatch fails", async () => {
    const spy = newSpy()
    spy.failNext = true
    const { app, dispose } = buildHarness(spy)
    try {
      const res = await post(app, { intent: "go" })
      expect(res.status).toBe(500)
      expect(await res.json()).toEqual({ error: "dispatch_failed", detail: "synthetic failure" })
    } finally {
      await dispose()
    }
  })

  it("surfaces pi's launch error detail when a pi dispatch dies on startup", async () => {
    const spy = newSpy()
    spy.piFailNext = new ShellError({
      message: "No API key for provider: anthropic",
      exitCode: 1,
      stderr: "No API key for provider: anthropic\n",
    })
    const { app, dispose } = buildHarness(spy)
    try {
      const res = await post(app, { intent: "go", harness: "pi" })
      expect(res.status).toBe(500)
      expect(await res.json()).toEqual({
        error: "dispatch_failed",
        detail: "No API key for provider: anthropic",
      })
    } finally {
      await dispose()
    }
  })

  it("routes harness 'pi' to PiRepo with pi-shaped fields, never ShellRepo", async () => {
    const spy = newSpy()
    const { app, dispose } = buildHarness(spy)
    try {
      const res = await post(app, {
        intent: "go",
        cwd: "/repo",
        harness: "pi",
        thinking: "high",
        model: "anthropic/claude-sonnet-5",
        tools: ["read", "bash"],
      })
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ short: spy.piReturn })
      expect(spy.calls).toHaveLength(0)
      expect(spy.piCalls).toEqual([
        {
          intent: "go",
          cwd: "/repo",
          thinking: "high",
          model: "anthropic/claude-sonnet-5",
          tools: ["read", "bash"],
        },
      ])
    } finally {
      await dispose()
    }
  })

  it("treats harness 'claude' as the default claude path", async () => {
    const spy = newSpy()
    const { app, dispose } = buildHarness(spy)
    try {
      const res = await post(app, { intent: "go", harness: "claude" })
      expect(res.status).toBe(200)
      expect(spy.calls).toHaveLength(1)
      expect(spy.piCalls).toHaveLength(0)
    } finally {
      await dispose()
    }
  })

  it("rejects an unknown harness with 400 rather than silently spawning claude", async () => {
    const spy = newSpy()
    const { app, dispose } = buildHarness(spy)
    try {
      const res = await post(app, { intent: "go", harness: "codex" })
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: "invalid_harness" })
      expect(spy.calls).toHaveLength(0)
      expect(spy.piCalls).toHaveLength(0)
    } finally {
      await dispose()
    }
  })
})

describe("GET /dispatch/pi-models", () => {
  it("returns the parsed pi model catalog", async () => {
    const { app, dispose } = buildHarness(newSpy())
    try {
      const res = await app.request("/pi-models")
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({
        models: [
          { provider: "anthropic", id: "claude-sonnet-5" },
          { provider: "github-copilot", id: "gpt-5-mini" },
        ],
      })
    } finally {
      await dispose()
    }
  })

  it("returns 500 pi_models_failed when pi cannot be queried", async () => {
    const spy = newSpy()
    spy.piModelsFailNext = true
    const { app, dispose } = buildHarness(spy)
    try {
      const res = await app.request("/pi-models")
      expect(res.status).toBe(500)
      expect(await res.json()).toEqual({ error: "pi_models_failed" })
    } finally {
      await dispose()
    }
  })
})
