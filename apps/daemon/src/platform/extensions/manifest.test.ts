import { describe, expect, it } from "bun:test"
import { parseManifest, sanitizeManifest } from "./manifest"

describe("parseManifest", () => {
  it("accepts a minimal valid manifest and defaults daemonEntry", () => {
    const res = parseManifest({ name: "my-ext", version: "1.0.0", tier: "esm" })
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.value.name).toBe("my-ext")
      expect(res.value.version).toBe("1.0.0")
      expect(res.value.tier).toBe("esm")
      expect(res.value.daemonEntry).toBe("daemon.ts")
    }
  })

  it("preserves contributes, permissions, daemonEntry and ui when provided", () => {
    const res = parseManifest({
      name: "full",
      version: "2.1.0",
      tier: "iframe",
      daemonEntry: "main.ts",
      ui: "index.html",
      contributes: { tabs: [{ id: "x" }] },
      permissions: { fs: ["/tmp"], exec: ["git"], net: ["api.example.com"], events: true },
    })
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.value.daemonEntry).toBe("main.ts")
      expect(res.value.ui).toBe("index.html")
      expect(res.value.contributes?.tabs).toEqual([{ id: "x" }])
      expect(res.value.permissions?.fs).toEqual(["/tmp"])
      expect(res.value.permissions?.events).toBe(true)
    }
  })

  it("rejects a non-object", () => {
    expect(parseManifest(null).ok).toBe(false)
    expect(parseManifest("nope").ok).toBe(false)
    expect(parseManifest(42).ok).toBe(false)
  })

  it("rejects an empty name", () => {
    const res = parseManifest({ name: "", version: "1.0.0", tier: "esm" })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toContain("name")
  })

  it("rejects an uppercase name", () => {
    const res = parseManifest({ name: "MyExt", version: "1.0.0", tier: "esm" })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toContain("name")
  })

  it("rejects a name with slashes (path segment safety)", () => {
    const res = parseManifest({ name: "a/b", version: "1.0.0", tier: "esm" })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toContain("name")
  })

  it("rejects a name with dot-dot traversal", () => {
    const res = parseManifest({ name: "..", version: "1.0.0", tier: "esm" })
    expect(res.ok).toBe(false)
  })

  it("rejects a missing/empty version", () => {
    expect(parseManifest({ name: "x", tier: "esm" }).ok).toBe(false)
    const res = parseManifest({ name: "x", version: "", tier: "esm" })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toContain("version")
  })

  it("rejects a bad tier", () => {
    const res = parseManifest({ name: "x", version: "1.0.0", tier: "native" })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toContain("tier")
  })
})

describe("sanitizeManifest", () => {
  it("exposes name, version, tier, contributes and a permission key summary but hides fs/exec values", () => {
    const m = parseManifest({
      name: "secret",
      version: "1.0.0",
      tier: "iframe",
      ui: "index.html",
      contributes: { cards: [{ id: "c" }] },
      permissions: {
        fs: ["/etc/passwd"],
        exec: ["danger-bin"],
        net: ["evil.example"],
        events: true,
      },
    })
    expect(m.ok).toBe(true)
    if (!m.ok) return
    const safe = sanitizeManifest(m.value)
    expect(safe.name).toBe("secret")
    expect(safe.version).toBe("1.0.0")
    expect(safe.tier).toBe("iframe")
    expect(safe.contributes?.cards).toEqual([{ id: "c" }])
    // permission keys requested are listed, but raw values are NOT exposed.
    expect(safe.permissions).toEqual(["fs", "exec", "net", "events"])
    const serialized = JSON.stringify(safe)
    expect(serialized).not.toContain("/etc/passwd")
    expect(serialized).not.toContain("danger-bin")
    expect(serialized).not.toContain("evil.example")
  })

  it("yields an empty permission list when none requested", () => {
    const m = parseManifest({ name: "p", version: "1.0.0", tier: "esm" })
    expect(m.ok).toBe(true)
    if (!m.ok) return
    expect(sanitizeManifest(m.value).permissions).toEqual([])
  })
})
