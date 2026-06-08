import { describe, expect, it } from "bun:test"
import type { ExtensionManifest } from "./manifest"
import { checkGrants } from "./permissions"

const mk = (permissions: ExtensionManifest["permissions"]): ExtensionManifest => ({
  name: "x",
  version: "1.0.0",
  tier: "esm",
  daemonEntry: "daemon.ts",
  permissions,
})

describe("checkGrants", () => {
  it("ok when manifest requests nothing", () => {
    expect(checkGrants(mk(undefined), {})).toEqual({ ok: true })
    expect(checkGrants(mk({}), {})).toEqual({ ok: true })
  })

  it("ok when requested is a subset of granted", () => {
    const m = mk({ fs: ["/tmp"], exec: ["git"], net: ["api.x.com"], events: true })
    const granted = { fs: ["/tmp", "/var"], exec: ["git", "ls"], net: ["api.x.com"], events: true }
    expect(checkGrants(m, granted)).toEqual({ ok: true })
  })

  it("reports each missing capability", () => {
    const m = mk({ fs: ["/tmp", "/secret"], exec: ["rm"], events: true })
    const res = checkGrants(m, { fs: ["/tmp"] })
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.missing).toContain("fs:/secret")
      expect(res.missing).toContain("exec:rm")
      expect(res.missing).toContain("events")
      expect(res.missing).not.toContain("fs:/tmp")
    }
  })

  it("treats a '*' grant as covering anything for that capability", () => {
    const m = mk({ fs: ["/a", "/b"], exec: ["anything"], net: ["any.host"] })
    const granted = { fs: ["*"], exec: ["*"], net: ["*"] }
    expect(checkGrants(m, granted)).toEqual({ ok: true })
  })

  it("missing events when requested but not granted", () => {
    const res = checkGrants(mk({ events: true }), {})
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.missing).toEqual(["events"])
  })

  it("missing git when requested but not granted", () => {
    const res = checkGrants(mk({ git: true }), {})
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.missing).toEqual(["git"])
  })

  it("ok when git is requested and granted", () => {
    expect(checkGrants(mk({ git: true }), { git: true })).toEqual({ ok: true })
  })
})
