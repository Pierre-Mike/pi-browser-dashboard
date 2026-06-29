import { describe, expect, it } from "bun:test"
import { FIELD_GROUPS, setField, settingsEqual } from "./fields"
import type { GlobalSettings } from "./types"

const base: GlobalSettings = {
  git: { defaultBranch: "main", remoteName: "origin" },
  library: { catalogPath: "/c.yaml", agenticRepoPath: "/agentic" },
  orchestration: {
    claudeBin: "claude",
    defaultAgent: "",
    defaultPermissionMode: "",
    defaultEffort: "",
    maxParallel: 10,
  },
  network: { projectsRoot: "/code", appPort: 8787, tunnelPort: 5173 },
  skillGroups: [],
}

describe("FIELD_GROUPS", () => {
  it("covers every field of every section, naming the on-disk key path", () => {
    const flat = FIELD_GROUPS.flatMap((g) => g.fields.map((f) => `${g.section}.${f.key}`))
    expect(flat).toEqual([
      "git.defaultBranch",
      "git.remoteName",
      "library.catalogPath",
      "library.agenticRepoPath",
      "orchestration.claudeBin",
      "orchestration.defaultAgent",
      "orchestration.defaultPermissionMode",
      "orchestration.defaultEffort",
      "orchestration.maxParallel",
      "network.projectsRoot",
      "network.appPort",
      "network.tunnelPort",
    ])
  })

  it("types numeric fields as number so the input coerces", () => {
    const numeric = FIELD_GROUPS.flatMap((g) =>
      g.fields.filter((f) => f.type === "number").map((f) => `${g.section}.${f.key}`),
    )
    expect(numeric).toEqual(["orchestration.maxParallel", "network.appPort", "network.tunnelPort"])
  })
})

describe("setField", () => {
  it("updates a string field immutably", () => {
    const next = setField({ settings: base, section: "git", key: "defaultBranch", raw: "trunk" })
    expect(next.git.defaultBranch).toBe("trunk")
    expect(next.git.remoteName).toBe("origin")
    expect(base.git.defaultBranch).toBe("main") // original untouched
  })

  it("coerces a numeric field from its string input", () => {
    const next = setField({ settings: base, section: "network", key: "appPort", raw: "9090" })
    expect(next.network.appPort).toBe(9090)
  })

  it("keeps the previous number when the input isn't a positive integer", () => {
    const port = (raw: string) =>
      setField({ settings: base, section: "network", key: "appPort", raw }).network.appPort
    expect(port("abc")).toBe(8787)
    expect(port("-3")).toBe(8787)
    expect(
      setField({ settings: base, section: "orchestration", key: "maxParallel", raw: "0" })
        .orchestration.maxParallel,
    ).toBe(10)
  })
})

describe("settingsEqual", () => {
  it("is true for deep-equal settings, false on any field change", () => {
    expect(settingsEqual(base, base)).toBe(true)
    expect(
      settingsEqual(
        base,
        setField({ settings: base, section: "git", key: "remoteName", raw: "upstream" }),
      ),
    ).toBe(false)
  })
})
