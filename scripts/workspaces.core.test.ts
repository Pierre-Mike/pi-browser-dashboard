import { describe, expect, it } from "bun:test"
import {
  expandWorkspacePattern,
  parseWorkspacePatterns,
  workspaceScanRoots,
} from "./workspaces.core"

describe("parseWorkspacePatterns", () => {
  it("reads a well-formed workspaces list", () => {
    expect(parseWorkspacePatterns({ pkg: { workspaces: ["apps/*", "shared"] } })).toEqual([
      "apps/*",
      "shared",
    ])
  })

  // Each of these used to compile fine behind `as { workspaces?: string[] }`,
  // and would have made the gate scan nothing at all.
  it("returns an empty list for every malformed shape rather than trusting a cast", () => {
    expect(parseWorkspacePatterns({ pkg: {} })).toEqual([])
    expect(parseWorkspacePatterns({ pkg: null })).toEqual([])
    expect(parseWorkspacePatterns({ pkg: "apps/*" })).toEqual([])
    expect(parseWorkspacePatterns({ pkg: { workspaces: "apps/*" } })).toEqual([])
    expect(parseWorkspacePatterns({ pkg: { workspaces: { packages: ["apps/*"] } } })).toEqual([])
  })

  it("drops non-string entries instead of passing them downstream", () => {
    expect(parseWorkspacePatterns({ pkg: { workspaces: ["apps/*", 7, null, "shared"] } })).toEqual([
      "apps/*",
      "shared",
    ])
  })
})

describe("expandWorkspacePattern", () => {
  it("expands a trailing glob against the parent's entries", () => {
    expect(expandWorkspacePattern({ pattern: "apps/*", entries: ["daemon", "web"] })).toEqual([
      "apps/daemon",
      "apps/web",
    ])
  })

  it("passes a literal path through untouched", () => {
    expect(expandWorkspacePattern({ pattern: "shared", entries: ["ignored"] })).toEqual(["shared"])
  })

  it("yields nothing when the parent directory is empty", () => {
    expect(expandWorkspacePattern({ pattern: "apps/*", entries: [] })).toEqual([])
  })
})

describe("workspaceScanRoots", () => {
  it("collapses globs to their parent and adds the extra roots", () => {
    expect(workspaceScanRoots({ patterns: ["apps/*", "shared"], extra: ["scripts"] })).toEqual([
      "apps",
      "scripts",
      "shared",
    ])
  })

  it("de-duplicates an extra root that is already a workspace", () => {
    expect(workspaceScanRoots({ patterns: ["scripts"], extra: ["scripts"] })).toEqual(["scripts"])
  })

  it("is order-independent — the result is sorted", () => {
    expect(workspaceScanRoots({ patterns: ["shared", "apps/*"], extra: [] })).toEqual([
      "apps",
      "shared",
    ])
  })
})
