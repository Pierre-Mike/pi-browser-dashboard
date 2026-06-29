import { describe, expect, it } from "bun:test"
import {
  DEFAULT_GLOBAL_SETTINGS,
  type GlobalSettings,
  gitBaseCandidates,
  mergeGlobalSettings,
  parseGlobalSettings,
  serializeGlobalSettings,
} from "./global-settings.core"

describe("parseGlobalSettings", () => {
  it("returns defaults for empty / nullish / malformed input", () => {
    expect(parseGlobalSettings("")).toEqual(DEFAULT_GLOBAL_SETTINGS)
    expect(parseGlobalSettings("   ")).toEqual(DEFAULT_GLOBAL_SETTINGS)
    expect(parseGlobalSettings(null)).toEqual(DEFAULT_GLOBAL_SETTINGS)
    expect(parseGlobalSettings(undefined)).toEqual(DEFAULT_GLOBAL_SETTINGS)
    expect(parseGlobalSettings("{not json")).toEqual(DEFAULT_GLOBAL_SETTINGS)
    expect(parseGlobalSettings("[1,2,3]")).toEqual(DEFAULT_GLOBAL_SETTINGS)
  })

  it("reads a full settings document", () => {
    const full: GlobalSettings = {
      git: { defaultBranch: "trunk", remoteName: "upstream" },
      library: { catalogPath: "/cat.yaml", agenticRepoPath: "/agentic" },
      orchestration: {
        claudeBin: "claude-next",
        defaultAgent: "scout",
        defaultPermissionMode: "auto",
        defaultEffort: "high",
        maxParallel: 8,
      },
      network: { projectsRoot: "/code", appPort: 9090, tunnelPort: 4000 },
      skillGroups: [{ name: "TDD flow", skills: ["tdd", "ts-axioms", "pr-automerge"] }],
    }
    expect(parseGlobalSettings(JSON.stringify(full))).toEqual(full)
  })

  it("fills missing sections and fields from defaults (partial doc)", () => {
    const parsed = parseGlobalSettings('{"git":{"defaultBranch":"develop"}}')
    expect(parsed.git.defaultBranch).toBe("develop")
    expect(parsed.git.remoteName).toBe(DEFAULT_GLOBAL_SETTINGS.git.remoteName)
    expect(parsed.orchestration).toEqual(DEFAULT_GLOBAL_SETTINGS.orchestration)
  })

  it("ignores wrong-typed fields field-by-field", () => {
    const parsed = parseGlobalSettings(
      '{"git":{"defaultBranch":42},"network":{"appPort":"nope","tunnelPort":3000}}',
    )
    expect(parsed.git.defaultBranch).toBe(DEFAULT_GLOBAL_SETTINGS.git.defaultBranch)
    expect(parsed.network.appPort).toBe(DEFAULT_GLOBAL_SETTINGS.network.appPort)
    expect(parsed.network.tunnelPort).toBe(3000)
  })

  it("rejects non-positive / non-integer ports and parallelism", () => {
    const parsed = parseGlobalSettings(
      '{"network":{"appPort":-1,"tunnelPort":0},"orchestration":{"maxParallel":0}}',
    )
    expect(parsed.network.appPort).toBe(DEFAULT_GLOBAL_SETTINGS.network.appPort)
    expect(parsed.network.tunnelPort).toBe(DEFAULT_GLOBAL_SETTINGS.network.tunnelPort)
    expect(parsed.orchestration.maxParallel).toBe(DEFAULT_GLOBAL_SETTINGS.orchestration.maxParallel)
  })
})

describe("mergeGlobalSettings", () => {
  it("applies a partial patch, leaving other fields untouched", () => {
    const next = mergeGlobalSettings(DEFAULT_GLOBAL_SETTINGS, {
      git: { defaultBranch: "release" },
      orchestration: { maxParallel: 3 },
    })
    expect(next.git.defaultBranch).toBe("release")
    expect(next.git.remoteName).toBe(DEFAULT_GLOBAL_SETTINGS.git.remoteName)
    expect(next.orchestration.maxParallel).toBe(3)
    expect(next.network).toEqual(DEFAULT_GLOBAL_SETTINGS.network)
  })

  it("drops invalid patch values (current wins), never corrupting state", () => {
    const next = mergeGlobalSettings(DEFAULT_GLOBAL_SETTINGS, {
      git: { defaultBranch: "" },
      network: { appPort: -5 },
    })
    expect(next.git.defaultBranch).toBe(DEFAULT_GLOBAL_SETTINGS.git.defaultBranch)
    expect(next.network.appPort).toBe(DEFAULT_GLOBAL_SETTINGS.network.appPort)
  })

  it("ignores a null/non-object patch", () => {
    expect(mergeGlobalSettings(DEFAULT_GLOBAL_SETTINGS, null)).toEqual(DEFAULT_GLOBAL_SETTINGS)
    expect(mergeGlobalSettings(DEFAULT_GLOBAL_SETTINGS, undefined)).toEqual(DEFAULT_GLOBAL_SETTINGS)
  })
})

describe("gitBaseCandidates", () => {
  it("yields the historical list for the default git settings", () => {
    expect(gitBaseCandidates(DEFAULT_GLOBAL_SETTINGS.git)).toEqual([
      "origin/main",
      "origin/master",
      "main",
      "master",
      "HEAD",
    ])
  })

  it("prefers the configured remote/branch", () => {
    expect(gitBaseCandidates({ defaultBranch: "develop", remoteName: "upstream" })).toEqual([
      "upstream/develop",
      "upstream/master",
      "develop",
      "master",
      "HEAD",
    ])
  })

  it("dedupes when the branch is already master", () => {
    expect(gitBaseCandidates({ defaultBranch: "master", remoteName: "origin" })).toEqual([
      "origin/master",
      "master",
      "HEAD",
    ])
  })
})

describe("serializeGlobalSettings", () => {
  it("round-trips through parse", () => {
    const text = serializeGlobalSettings(DEFAULT_GLOBAL_SETTINGS)
    expect(text.endsWith("\n")).toBe(true)
    expect(parseGlobalSettings(text)).toEqual(DEFAULT_GLOBAL_SETTINGS)
  })
})

describe("skillGroups", () => {
  it("defaults to an empty list", () => {
    expect(DEFAULT_GLOBAL_SETTINGS.skillGroups).toEqual([])
    expect(parseGlobalSettings(null).skillGroups).toEqual([])
  })

  it("reads valid groups, preserving group and skill order", () => {
    const parsed = parseGlobalSettings(
      '{"skillGroups":[{"name":"TDD flow","skills":["tdd","ts-axioms"]},{"name":"Research","skills":["deep-research"]}]}',
    )
    expect(parsed.skillGroups).toEqual([
      { name: "TDD flow", skills: ["tdd", "ts-axioms"] },
      { name: "Research", skills: ["deep-research"] },
    ])
  })

  it("ignores a non-array skillGroups (keeps default)", () => {
    expect(parseGlobalSettings('{"skillGroups":"nope"}').skillGroups).toEqual([])
    expect(parseGlobalSettings('{"skillGroups":{"name":"x"}}').skillGroups).toEqual([])
  })

  it("drops entries with no/blank name and non-object entries", () => {
    const parsed = parseGlobalSettings(
      '{"skillGroups":[42,{"skills":["a"]},{"name":"","skills":["a"]},{"name":"keep","skills":["a"]}]}',
    )
    expect(parsed.skillGroups).toEqual([{ name: "keep", skills: ["a"] }])
  })

  it("coerces a missing/invalid skills field to an empty list and drops blank skill ids", () => {
    const parsed = parseGlobalSettings(
      '{"skillGroups":[{"name":"empty"},{"name":"mixed","skills":["tdd","",42,"  ","ts-axioms"]}]}',
    )
    expect(parsed.skillGroups).toEqual([
      { name: "empty", skills: [] },
      { name: "mixed", skills: ["tdd", "ts-axioms"] },
    ])
  })

  it("dedupes skills within a group and groups by name (first wins)", () => {
    const parsed = parseGlobalSettings(
      '{"skillGroups":[{"name":"dup","skills":["tdd","tdd","ts-axioms"]},{"name":"dup","skills":["other"]}]}',
    )
    expect(parsed.skillGroups).toEqual([{ name: "dup", skills: ["tdd", "ts-axioms"] }])
  })

  it("merge replaces the whole list when the patch provides skillGroups", () => {
    const seeded = mergeGlobalSettings(DEFAULT_GLOBAL_SETTINGS, {
      skillGroups: [{ name: "a", skills: ["x"] }],
    })
    expect(seeded.skillGroups).toEqual([{ name: "a", skills: ["x"] }])
    const replaced = mergeGlobalSettings(seeded, {
      skillGroups: [{ name: "b", skills: ["y"] }],
    })
    expect(replaced.skillGroups).toEqual([{ name: "b", skills: ["y"] }])
    const cleared = mergeGlobalSettings(replaced, { skillGroups: [] })
    expect(cleared.skillGroups).toEqual([])
  })

  it("merge leaves skillGroups untouched when the patch omits them", () => {
    const seeded = mergeGlobalSettings(DEFAULT_GLOBAL_SETTINGS, {
      skillGroups: [{ name: "a", skills: ["x"] }],
    })
    const next = mergeGlobalSettings(seeded, { git: { defaultBranch: "dev" } })
    expect(next.skillGroups).toEqual([{ name: "a", skills: ["x"] }])
  })
})
