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
