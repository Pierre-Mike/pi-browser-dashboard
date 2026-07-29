import { describe, expect, it } from "bun:test"
import { decodeGlobalSettings } from "./global-settings"

// A full document, matching what the daemon serializes. Every section is
// required on the wire: the daemon fills missing fields from its own defaults
// before responding, so a client never sees a half-populated body.
const full = {
  git: { defaultBranch: "main", remoteName: "origin" },
  library: { catalogPath: "/lib/catalog.yaml", agenticRepoPath: "/lib/agentic" },
  orchestration: {
    claudeBin: "claude",
    defaultAgent: "",
    defaultPermissionMode: "",
    defaultEffort: "",
    maxParallel: 10,
  },
  network: { projectsRoot: "/code", appPort: 8787, tunnelPort: 5173 },
  ui: { themeFamily: "pid", themeMode: "system" },
  skillGroups: [{ name: "TDD flow", skills: ["tdd", "ts-axioms"] }],
} as const

describe("decodeGlobalSettings", () => {
  it("round-trips a full document through JSON", () => {
    expect(decodeGlobalSettings(JSON.parse(JSON.stringify(full)))).toEqual(full)
  })

  it("accepts an empty skill-group list", () => {
    expect(decodeGlobalSettings({ ...full, skillGroups: [] }).skillGroups).toEqual([])
  })

  // The assertions the deleted apps/web copy (globalSettings.parse.ts) carried.
  // They belong to the contract, not to one workspace's hand-written decoder.
  it("rejects a missing section", () => {
    const { git: _git, ...rest } = full
    expect(() => decodeGlobalSettings(rest)).toThrow()
  })

  it("rejects a wrong primitive type rather than coercing it", () => {
    expect(() =>
      decodeGlobalSettings({ ...full, orchestration: { ...full.orchestration, maxParallel: "4" } }),
    ).toThrow()
    expect(() =>
      decodeGlobalSettings({ ...full, network: { ...full.network, appPort: "8787" } }),
    ).toThrow()
  })

  it("rejects a malformed skill group", () => {
    expect(() => decodeGlobalSettings({ ...full, skillGroups: [{ name: "writing" }] })).toThrow()
    expect(() => decodeGlobalSettings({ ...full, skillGroups: "nope" })).toThrow()
  })

  it("rejects a non-object", () => {
    expect(() => decodeGlobalSettings(null)).toThrow()
    expect(() => decodeGlobalSettings([1, 2, 3])).toThrow()
  })

  // The `ui` halves are opaque strings on the wire: the theme vocabulary lives
  // in apps/web next to tailwind.config.js, so a family this daemon has never
  // heard of has to survive the trip and be resolved by the reader.
  it("carries an unrecognised theme family through untouched", () => {
    const decoded = decodeGlobalSettings({
      ...full,
      ui: { themeFamily: "vaporwave", themeMode: "sepia" },
    })
    expect(decoded.ui).toEqual({ themeFamily: "vaporwave", themeMode: "sepia" })
  })

  it("accepts the empty halves that mean 'no machine-wide default'", () => {
    expect(decodeGlobalSettings({ ...full, ui: { themeFamily: "", themeMode: "" } }).ui).toEqual({
      themeFamily: "",
      themeMode: "",
    })
  })

  it("rejects a ui section that is missing a half", () => {
    expect(() => decodeGlobalSettings({ ...full, ui: { themeFamily: "pid" } })).toThrow()
  })

  it("rejects an undocumented top-level field", () => {
    expect(() => decodeGlobalSettings({ ...full, bogus: true })).toThrow()
  })

  // The half the web mirror could never have caught: a section gaining a field
  // on the daemon side. Strictness has to reach *inside* a section, or the
  // contract only guards its outermost layer.
  it("rejects an undocumented field inside a section", () => {
    expect(() =>
      decodeGlobalSettings({ ...full, git: { ...full.git, upstreamName: "fork" } }),
    ).toThrow()
  })
})
