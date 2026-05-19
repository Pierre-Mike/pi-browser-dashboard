import { describe, expect, it } from "bun:test"
import { Effect, Layer, ManagedRuntime } from "effect"
import {
  type DispatchInput,
  ShellError,
  ShellRepo,
  type ShellRepoApi,
} from "../../platform/shell.repo"
import { buildDispatchApp } from "./dispatch.routes"

type Spy = {
  readonly calls: DispatchInput[]
  shortReturn: string
  failNext: boolean
}

const newSpy = (): Spy => ({ calls: [], shortReturn: "abcd1234", failNext: false })

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

const buildHarness = (spy: Spy) => {
  const runtime = ManagedRuntime.make(buildShellLayer(spy))
  return { app: buildDispatchApp(runtime), dispose: () => runtime.dispose() }
}

const post = (app: ReturnType<typeof buildDispatchApp>, body: unknown): Promise<Response> =>
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
        { intent: "fix bug", cwd: "/repo", agent: "reviewer", permissionMode: undefined },
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
      })
    } finally {
      await dispose()
    }
  })

  it("returns 500 dispatch_failed when ShellRepo.dispatch fails", async () => {
    const spy = newSpy()
    spy.failNext = true
    const { app, dispose } = buildHarness(spy)
    try {
      const res = await post(app, { intent: "go" })
      expect(res.status).toBe(500)
      expect(await res.json()).toEqual({ error: "dispatch_failed" })
    } finally {
      await dispose()
    }
  })
})
