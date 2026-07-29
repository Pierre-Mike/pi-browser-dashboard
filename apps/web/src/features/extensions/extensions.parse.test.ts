import { describe, expect, it } from "bun:test"
import { parseExtensionManifest, parseExtensionManifests } from "./extensions.parse"
import type { ExtensionManifest } from "./types"

const valid: Omit<ExtensionManifest, "contributes"> = {
  name: "canvas-tools",
  version: "1.0.0",
  tier: "iframe",
  permissions: ["fs:read"],
  scope: "global",
  requested: ["fs:read", "fs:write"],
  granted: ["fs:read"],
  enabled: true,
}

describe("parseExtensionManifest", () => {
  it("accepts a well-formed manifest with no contributes/projectPath", () => {
    expect(parseExtensionManifest(valid)).toEqual({ ...valid, contributes: undefined })
  })

  it("passes through contributes' array fields without validating their contents", () => {
    const withContributes = { ...valid, contributes: { tabs: [{ anything: "goes" }], cards: [1] } }
    expect(parseExtensionManifest(withContributes)?.contributes).toEqual({
      tabs: [{ anything: "goes" }],
      projectPanels: undefined,
      cards: [1],
      panels: undefined,
      commands: undefined,
    })
  })

  it("accepts a local-scoped manifest with a projectPath", () => {
    const local = { ...valid, scope: "local", projectPath: "/repo/proj" }
    expect(parseExtensionManifest(local)?.projectPath).toBe("/repo/proj")
  })

  it("rejects an unrecognized tier or scope", () => {
    expect(parseExtensionManifest({ ...valid, tier: "wasm" })).toBeNull()
    expect(parseExtensionManifest({ ...valid, scope: "org" })).toBeNull()
  })

  it("rejects a non-string-array permissions/requested/granted field", () => {
    expect(parseExtensionManifest({ ...valid, permissions: "fs:read" })).toBeNull()
  })

  it("rejects a non-boolean enabled", () => {
    expect(parseExtensionManifest({ ...valid, enabled: "true" })).toBeNull()
  })

  it("rejects a non-object", () => {
    expect(parseExtensionManifest(null)).toBeNull()
  })
})

describe("parseExtensionManifests", () => {
  it("parses a list", () => {
    expect(parseExtensionManifests([valid])).toEqual([{ ...valid, contributes: undefined }])
  })

  it("fails the whole list on one bad entry", () => {
    expect(parseExtensionManifests([valid, { ...valid, tier: "wasm" }])).toBeNull()
  })
})
