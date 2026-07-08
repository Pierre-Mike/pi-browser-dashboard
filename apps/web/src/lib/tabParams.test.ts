import { describe, expect, it } from "bun:test"
import { coerceEnumTab, coerceExtTab, coerceNamespacedTab } from "./tabParams"

describe("coerceEnumTab", () => {
  const keys = ["chat", "canvas", "terminal", "files"] as const

  it("returns a known key unchanged", () => {
    expect(coerceEnumTab("chat", keys)).toBe("chat")
    expect(coerceEnumTab("files", keys)).toBe("files")
  })

  it("returns undefined for an unknown string", () => {
    expect(coerceEnumTab("bogus", keys)).toBeUndefined()
  })

  it("returns undefined for a namespaced ext key (no ext support here)", () => {
    expect(coerceEnumTab("ext:foo", keys)).toBeUndefined()
  })

  it("returns undefined for non-string input", () => {
    expect(coerceEnumTab(undefined, keys)).toBeUndefined()
    expect(coerceEnumTab(42, keys)).toBeUndefined()
    expect(coerceEnumTab(null, keys)).toBeUndefined()
    expect(coerceEnumTab({ tab: "chat" }, keys)).toBeUndefined()
  })
})

describe("coerceExtTab", () => {
  const staticKeys = ["projects", "terminal", "claude", "library", "extensions", "tunnel"] as const

  it("returns a known static key unchanged", () => {
    expect(coerceExtTab("projects", staticKeys)).toBe("projects")
    expect(coerceExtTab("tunnel", staticKeys)).toBe("tunnel")
  })

  it("accepts a namespaced ext key", () => {
    expect(coerceExtTab("ext:my-extension", staticKeys)).toBe("ext:my-extension")
    expect(coerceExtTab("ext:a", staticKeys)).toBe("ext:a")
  })

  it("returns undefined for an empty ext namespace", () => {
    expect(coerceExtTab("ext:", staticKeys)).toBeUndefined()
  })

  it("returns undefined for an unknown string", () => {
    expect(coerceExtTab("bogus", staticKeys)).toBeUndefined()
  })

  it("returns undefined for non-string input", () => {
    expect(coerceExtTab(undefined, staticKeys)).toBeUndefined()
    expect(coerceExtTab(7, staticKeys)).toBeUndefined()
    expect(coerceExtTab(null, staticKeys)).toBeUndefined()
  })
})

describe("coerceNamespacedTab", () => {
  const staticKeys = ["sessions", "pidapps", "brainstorm"] as const
  const prefixes = ["ext:", "pidapp:", "brainstorm:"] as const

  it("returns a known static key unchanged (incl. parent tabs of dynamic families)", () => {
    expect(coerceNamespacedTab("sessions", { staticKeys, prefixes })).toBe("sessions")
    expect(coerceNamespacedTab("pidapps", { staticKeys, prefixes })).toBe("pidapps")
    expect(coerceNamespacedTab("brainstorm", { staticKeys, prefixes })).toBe("brainstorm")
  })

  it("accepts every allowed namespace so deep links survive validateSearch", () => {
    expect(coerceNamespacedTab("ext:my-extension", { staticKeys, prefixes })).toBe(
      "ext:my-extension",
    )
    expect(coerceNamespacedTab("pidapp:plan", { staticKeys, prefixes })).toBe("pidapp:plan")
    expect(coerceNamespacedTab("brainstorm:auth-flow", { staticKeys, prefixes })).toBe(
      "brainstorm:auth-flow",
    )
  })

  it("rejects a bare prefix, unknown namespaces, unknown keys, and non-strings", () => {
    expect(coerceNamespacedTab("pidapp:", { staticKeys, prefixes })).toBeUndefined()
    expect(coerceNamespacedTab("weird:x", { staticKeys, prefixes })).toBeUndefined()
    expect(coerceNamespacedTab("bogus", { staticKeys, prefixes })).toBeUndefined()
    expect(coerceNamespacedTab(7, { staticKeys, prefixes })).toBeUndefined()
  })
})
