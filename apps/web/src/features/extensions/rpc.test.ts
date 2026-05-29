import { describe, expect, it } from "bun:test"
import { dispatchRpc } from "./rpc"
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
    const result = await dispatchRpc(req, BAD_ORIGIN, ORIGIN, baseManifest())
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe("bad_origin")
      expect(result.error).toContain(BAD_ORIGIN)
    }
  })

  it("accepts a message from the matching origin", async () => {
    const req = { id: "1", method: "getContext" }
    const result = await dispatchRpc(req, ORIGIN, ORIGIN, baseManifest())
    expect(result.ok).toBe(true)
  })
})

describe("dispatchRpc — size cap", () => {
  it("rejects a message exceeding 256 KB", async () => {
    const bigPayload = { id: "2", method: "getContext", params: "x".repeat(260 * 1024) }
    const result = await dispatchRpc(bigPayload, ORIGIN, ORIGIN, baseManifest())
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe("oversize")
    }
  })

  it("accepts a message within size limit", async () => {
    const req = { id: "3", method: "getContext" }
    const result = await dispatchRpc(req, ORIGIN, ORIGIN, baseManifest())
    expect(result.ok).toBe(true)
  })
})

describe("dispatchRpc — permission gate", () => {
  it("rejects listFiles when fs permission not granted", async () => {
    const req = { id: "4", method: "listFiles", params: { path: "." } }
    const result = await dispatchRpc(req, ORIGIN, ORIGIN, baseManifest())
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe("no_permission")
      expect(result.error).toContain("fs")
    }
  })

  it("rejects readFile when fs permission not granted", async () => {
    const req = { id: "5", method: "readFile", params: { path: "README.md" } }
    const result = await dispatchRpc(req, ORIGIN, ORIGIN, baseManifest())
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe("no_permission")
    }
  })

  it("rejects subscribeEvents when events permission not granted", async () => {
    const req = { id: "6", method: "subscribeEvents" }
    const result = await dispatchRpc(req, ORIGIN, ORIGIN, baseManifest())
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe("no_permission")
    }
  })

  it("allows listFiles when fs is in granted (not just requested)", async () => {
    // granted=["fs"] → gate passes; no projectId → returns { entries: [] }
    const manifest = { ...baseManifest(), granted: ["fs"] }
    const req = { id: "7", method: "listFiles", params: { path: "." } }
    const result = await dispatchRpc(req, ORIGIN, ORIGIN, manifest, {})
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect((result.result as { entries: unknown[] }).entries).toEqual([])
    }
  })

  it("rejects listFiles when fs is requested but NOT granted", async () => {
    // requested has fs but granted is empty → must still be denied
    const manifest = { ...baseManifest(), requested: ["fs"], granted: [] }
    const req = { id: "7b", method: "listFiles", params: { path: "." } }
    const result = await dispatchRpc(req, ORIGIN, ORIGIN, manifest, {})
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe("no_permission")
      expect(result.error).toContain("fs")
    }
  })

  it("allows subscribeEvents when events is in granted", async () => {
    const manifest = { ...baseManifest(), granted: ["events"] }
    const req = { id: "8", method: "subscribeEvents" }
    const result = await dispatchRpc(req, ORIGIN, ORIGIN, manifest)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect((result.result as { subscribed: boolean }).subscribed).toBe(true)
    }
  })
})

describe("dispatchRpc — getContext", () => {
  it("returns projectId and cwd from context", async () => {
    const req = { id: "9", method: "getContext" }
    const result = await dispatchRpc(req, ORIGIN, ORIGIN, baseManifest(), {
      projectId: "proj-123",
      cwd: "/home/user/project",
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
    const result = await dispatchRpc(req, ORIGIN, ORIGIN, baseManifest())
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
    const result = await dispatchRpc(req, ORIGIN, ORIGIN, baseManifest())
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe("no_permission")
    }
  })
})

describe("dispatchRpc — malformed message", () => {
  it("rejects a non-object message", async () => {
    const result = await dispatchRpc("not-an-object", ORIGIN, ORIGIN, baseManifest())
    expect(result.ok).toBe(false)
  })

  it("rejects a message without id or method", async () => {
    const result = await dispatchRpc({ foo: "bar" }, ORIGIN, ORIGIN, baseManifest())
    expect(result.ok).toBe(false)
  })
})
