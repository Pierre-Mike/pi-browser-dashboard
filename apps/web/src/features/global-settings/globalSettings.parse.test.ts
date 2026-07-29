import { describe, expect, it } from "bun:test"
import { parseGlobalSettings } from "./globalSettings.parse"

const valid = {
  git: { defaultBranch: "main", remoteName: "origin" },
  library: { catalogPath: "/lib/catalog.json", agenticRepoPath: "/lib/agentic" },
  orchestration: {
    claudeBin: "claude",
    defaultAgent: "claude",
    defaultPermissionMode: "default",
    defaultEffort: "medium",
    maxParallel: 4,
  },
  network: { projectsRoot: "/projects", appPort: 8787, tunnelPort: 8788 },
  skillGroups: [{ name: "writing", skills: ["editor", "proofreader"] }],
}

describe("parseGlobalSettings", () => {
  it("accepts a well-formed settings object", () => {
    expect(parseGlobalSettings(valid)).toEqual(valid)
  })

  it("accepts an empty skillGroups list", () => {
    expect(parseGlobalSettings({ ...valid, skillGroups: [] })?.skillGroups).toEqual([])
  })

  it("rejects a missing nested section", () => {
    const { git, ...rest } = valid
    expect(parseGlobalSettings(rest)).toBeNull()
  })

  it("rejects a wrong-typed field inside a nested section", () => {
    expect(
      parseGlobalSettings({
        ...valid,
        orchestration: { ...valid.orchestration, maxParallel: "4" },
      }),
    ).toBeNull()
  })

  it("rejects a malformed skill group", () => {
    expect(parseGlobalSettings({ ...valid, skillGroups: [{ name: "writing" }] })).toBeNull()
  })

  it("rejects a non-object", () => {
    expect(parseGlobalSettings(null)).toBeNull()
  })
})
