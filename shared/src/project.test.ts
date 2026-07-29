import { describe, expect, it } from "bun:test"
import { decodeProject, decodeProjectArray } from "./project"

const minimal = {
  id: "p1",
  name: "pi-browser-dashboard",
  path: "/Users/x/Github/pi-browser-dashboard",
  isGitRepo: true,
  lastModified: 1_753_000_000_000,
} as const

describe("decodeProject", () => {
  it("accepts a checkout with no github remote and no commits", () => {
    const decoded = decodeProject(minimal)
    expect(decoded.branch).toBeUndefined()
    expect(decoded.lastCommitMs).toBeUndefined()
  })

  it("round-trips the github fields through JSON", () => {
    const full = {
      ...minimal,
      lastCommitMs: 1_753_000_000_001,
      branch: "main",
      githubUrl: "https://github.com/Pierre-Mike/pi-browser-dashboard",
      githubOwner: "Pierre-Mike",
      githubRepo: "pi-browser-dashboard",
    }
    expect(decodeProject(JSON.parse(JSON.stringify(full)))).toEqual(full)
  })

  // The field apps/web's hand-written mirror never gained.
  it("carries lastCommitMs, which the old web mirror had drifted away from", () => {
    expect(decodeProject({ ...minimal, lastCommitMs: 42 }).lastCommitMs).toBe(42)
  })

  it("rejects an undocumented field", () => {
    expect(() => decodeProject({ ...minimal, stars: 3 })).toThrow()
  })

  it("rejects a wrong primitive type rather than coercing it", () => {
    expect(() => decodeProject({ ...minimal, isGitRepo: "true" })).toThrow()
    expect(() => decodeProject({ ...minimal, lastModified: "1753000000000" })).toThrow()
  })
})

describe("decodeProjectArray", () => {
  it("decodes a list response", () => {
    expect(decodeProjectArray([minimal])).toHaveLength(1)
  })
})
