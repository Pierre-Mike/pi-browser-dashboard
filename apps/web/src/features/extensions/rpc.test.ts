import { describe, expect, it } from "bun:test"
import { buildEventEnvelope, dispatchRpc, shouldForwardEvent } from "./rpc"
import type { ExtensionManifest } from "./types"

const baseManifest = (): ExtensionManifest => ({
  name: "test-ext",
  version: "1.0.0",
  tier: "iframe",
  permissions: [],
  scope: "global",
  requested: [],
  granted: [],
  enabled: true,
})

const ORIGIN = "http://localhost:8787"
const BAD_ORIGIN = "http://evil.example.com"

describe("dispatchRpc — origin validation", () => {
  it("rejects a message from a different origin", async () => {
    const req = { id: "1", method: "getContext" }
    const result = await dispatchRpc({
      rawData: req,
      origin: BAD_ORIGIN,
      expectedOrigin: ORIGIN,
      manifest: baseManifest(),
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe("bad_origin")
      expect(result.error).toContain(BAD_ORIGIN)
    }
  })

  it("accepts a message from the matching origin", async () => {
    const req = { id: "1", method: "getContext" }
    const result = await dispatchRpc({
      rawData: req,
      origin: ORIGIN,
      expectedOrigin: ORIGIN,
      manifest: baseManifest(),
    })
    expect(result.ok).toBe(true)
  })
})

describe("dispatchRpc — size cap", () => {
  it("rejects a message exceeding 256 KB", async () => {
    const bigPayload = { id: "2", method: "getContext", params: "x".repeat(260 * 1024) }
    const result = await dispatchRpc({
      rawData: bigPayload,
      origin: ORIGIN,
      expectedOrigin: ORIGIN,
      manifest: baseManifest(),
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe("oversize")
    }
  })

  it("accepts a message within size limit", async () => {
    const req = { id: "3", method: "getContext" }
    const result = await dispatchRpc({
      rawData: req,
      origin: ORIGIN,
      expectedOrigin: ORIGIN,
      manifest: baseManifest(),
    })
    expect(result.ok).toBe(true)
  })
})

describe("dispatchRpc — permission gate", () => {
  it("rejects listFiles when fs permission not granted", async () => {
    const req = { id: "4", method: "listFiles", params: { path: "." } }
    const result = await dispatchRpc({
      rawData: req,
      origin: ORIGIN,
      expectedOrigin: ORIGIN,
      manifest: baseManifest(),
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe("no_permission")
      expect(result.error).toContain("fs")
    }
  })

  it("rejects readFile when fs permission not granted", async () => {
    const req = { id: "5", method: "readFile", params: { path: "README.md" } }
    const result = await dispatchRpc({
      rawData: req,
      origin: ORIGIN,
      expectedOrigin: ORIGIN,
      manifest: baseManifest(),
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe("no_permission")
    }
  })

  it("rejects subscribeEvents when events permission not granted", async () => {
    const req = { id: "6", method: "subscribeEvents" }
    const result = await dispatchRpc({
      rawData: req,
      origin: ORIGIN,
      expectedOrigin: ORIGIN,
      manifest: baseManifest(),
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe("no_permission")
    }
  })

  it("allows listFiles when fs is in granted (not just requested)", async () => {
    // granted=["fs"] → gate passes; no projectId → returns { entries: [] }
    const manifest = { ...baseManifest(), granted: ["fs"] }
    const req = { id: "7", method: "listFiles", params: { path: "." } }
    const result = await dispatchRpc({
      rawData: req,
      origin: ORIGIN,
      expectedOrigin: ORIGIN,
      manifest,
      ctx: {},
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect((result.result as { entries: unknown[] }).entries).toEqual([])
    }
  })

  it("rejects listFiles when fs is requested but NOT granted", async () => {
    // requested has fs but granted is empty → must still be denied
    const manifest = { ...baseManifest(), requested: ["fs"], granted: [] }
    const req = { id: "7b", method: "listFiles", params: { path: "." } }
    const result = await dispatchRpc({
      rawData: req,
      origin: ORIGIN,
      expectedOrigin: ORIGIN,
      manifest,
      ctx: {},
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe("no_permission")
      expect(result.error).toContain("fs")
    }
  })

  it("rejects gitStatus when git permission not granted", async () => {
    const req = { id: "g1", method: "gitStatus" }
    const result = await dispatchRpc({
      rawData: req,
      origin: ORIGIN,
      expectedOrigin: ORIGIN,
      manifest: baseManifest(),
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe("no_permission")
      expect(result.error).toContain("git")
    }
  })

  it("rejects gitLog when git permission not granted", async () => {
    const req = { id: "g2", method: "gitLog", params: { limit: 5 } }
    const result = await dispatchRpc({
      rawData: req,
      origin: ORIGIN,
      expectedOrigin: ORIGIN,
      manifest: baseManifest(),
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe("no_permission")
  })

  it("passes the git gate but errors without a projectId in context", async () => {
    // granted=["git"] → permission gate passes; handler then needs a projectId.
    const manifest = { ...baseManifest(), granted: ["git"] }
    const req = { id: "g3", method: "gitStatus" }
    const result = await dispatchRpc({
      rawData: req,
      origin: ORIGIN,
      expectedOrigin: ORIGIN,
      manifest,
      ctx: {},
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      // Past the permission gate — fails in the handler, not the gate.
      expect(result.code).toBe("error")
      expect(result.error).toContain("projectId")
    }
  })

  it("allows subscribeEvents when events is in granted", async () => {
    const manifest = { ...baseManifest(), granted: ["events"] }
    const req = { id: "8", method: "subscribeEvents" }
    const result = await dispatchRpc({
      rawData: req,
      origin: ORIGIN,
      expectedOrigin: ORIGIN,
      manifest,
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect((result.result as { subscribed: boolean }).subscribed).toBe(true)
    }
  })
})

describe("dispatchRpc — getContext", () => {
  it("returns projectId and cwd from context", async () => {
    const req = { id: "9", method: "getContext" }
    const result = await dispatchRpc({
      rawData: req,
      origin: ORIGIN,
      expectedOrigin: ORIGIN,
      manifest: baseManifest(),
      ctx: { projectId: "proj-123", cwd: "/home/user/project" },
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      const r = result.result as Record<string, unknown>
      expect(r.projectId).toBe("proj-123")
      expect(r.cwd).toBe("/home/user/project")
      expect(r.extensionName).toBe("test-ext")
    }
  })

  it("returns null for projectId/cwd when not provided", async () => {
    const req = { id: "10", method: "getContext" }
    const result = await dispatchRpc({
      rawData: req,
      origin: ORIGIN,
      expectedOrigin: ORIGIN,
      manifest: baseManifest(),
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      const r = result.result as Record<string, unknown>
      expect(r.projectId).toBeNull()
      expect(r.cwd).toBeNull()
    }
  })
})

describe("dispatchRpc — unknown method", () => {
  it("rejects unknown method with no_permission code", async () => {
    const req = { id: "11", method: "launchMissile" }
    const result = await dispatchRpc({
      rawData: req,
      origin: ORIGIN,
      expectedOrigin: ORIGIN,
      manifest: baseManifest(),
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe("no_permission")
    }
  })
})

describe("shouldForwardEvent — least-privilege event forwarding", () => {
  const ext = (over: Partial<ExtensionManifest> = {}): ExtensionManifest => ({
    ...baseManifest(),
    name: "repo-explorer",
    granted: ["events"],
    ...over,
  })

  it("forwards an event namespaced to this extension once subscribed + granted", () => {
    expect(
      shouldForwardEvent({
        manifest: ext(),
        granted: ["events"],
        subscribed: true,
        event: { type: "ext:repo-explorer:file-changed", data: { path: "a.ts" } },
      }),
    ).toBe(true)
  })

  it("blocks before the iframe has subscribed", () => {
    expect(
      shouldForwardEvent({
        manifest: ext(),
        granted: ["events"],
        subscribed: false,
        event: { type: "ext:repo-explorer:file-changed", data: {} },
      }),
    ).toBe(false)
  })

  it("blocks when the events permission is not granted", () => {
    expect(
      shouldForwardEvent({
        manifest: ext({ granted: [] }),
        granted: [],
        subscribed: true,
        event: { type: "ext:repo-explorer:file-changed", data: {} },
      }),
    ).toBe(false)
  })

  it("blocks another extension's namespaced events (no cross-extension leak)", () => {
    expect(
      shouldForwardEvent({
        manifest: ext(),
        granted: ["events"],
        subscribed: true,
        event: { type: "ext:other-ext:secret", data: { token: "x" } },
      }),
    ).toBe(false)
  })

  it("does not let a name prefix collision leak (repo-explorer vs repo-explorer-evil)", () => {
    expect(
      shouldForwardEvent({
        manifest: ext(),
        granted: ["events"],
        subscribed: true,
        event: { type: "ext:repo-explorer-evil:secret", data: {} },
      }),
    ).toBe(false)
  })

  it("blocks the global/session firehose (non-ext events never forwarded)", () => {
    for (const type of ["session.state", "roster.changed", "heartbeat", "ext:state-changed"]) {
      expect(
        shouldForwardEvent({
          manifest: ext(),
          granted: ["events"],
          subscribed: true,
          event: { type, data: {} },
        }),
      ).toBe(false)
    }
  })

  it("forwards a project-scoped whitelisted event only for the bound project", () => {
    const inScope = shouldForwardEvent({
      manifest: ext(),
      granted: ["events"],
      subscribed: true,
      projectId: "proj-1",
      event: { type: "session.state", data: { projectId: "proj-1", short: "ab12" } },
    })
    const outOfScope = shouldForwardEvent({
      manifest: ext(),
      granted: ["events"],
      subscribed: true,
      projectId: "proj-1",
      event: { type: "session.state", data: { projectId: "proj-2", short: "cd34" } },
    })
    // Project scoping is conservative: even in-scope session events stay withheld
    // unless explicitly whitelisted. Both must be false here — only ext:<name>:*
    // is forwarded by default.
    expect(inScope).toBe(false)
    expect(outOfScope).toBe(false)
  })
})

describe("buildEventEnvelope — push envelope shape", () => {
  it("produces a typed event envelope distinct from an RPC response (no id)", () => {
    const env = buildEventEnvelope("ext:repo-explorer:tick", { n: 1 })
    expect(env.type).toBe("event")
    expect(env.channel).toBe("ext:repo-explorer:tick")
    expect(env.payload).toEqual({ n: 1 })
    expect("id" in env).toBe(false)
  })
})

describe("dispatchRpc — malformed message", () => {
  it("rejects a non-object message", async () => {
    const result = await dispatchRpc({
      rawData: "not-an-object",
      origin: ORIGIN,
      expectedOrigin: ORIGIN,
      manifest: baseManifest(),
    })
    expect(result.ok).toBe(false)
  })

  it("rejects a message without id or method", async () => {
    const result = await dispatchRpc({
      rawData: { foo: "bar" },
      origin: ORIGIN,
      expectedOrigin: ORIGIN,
      manifest: baseManifest(),
    })
    expect(result.ok).toBe(false)
  })
})
