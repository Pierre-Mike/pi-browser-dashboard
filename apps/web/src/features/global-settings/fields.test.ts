import { describe, expect, it } from "bun:test"
import type { GlobalSettings } from "@pid/shared"
import {
  FIELD_GROUPS,
  formSectionsEqual,
  reseedDraft,
  setField,
  settingsEqual,
  toFormPatch,
} from "./fields"

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
  ui: { themeFamily: "", themeMode: "" },
  skillGroups: [],
}

const withUi = (settings: GlobalSettings, themeFamily: string): GlobalSettings => ({
  ...settings,
  ui: { themeFamily, themeMode: "dark" },
})

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

  it("counts a ui change, which is what makes it the wrong test for `dirty`", () => {
    expect(settingsEqual(base, withUi(base, "mono"))).toBe(false)
  })
})

describe("toFormPatch", () => {
  // The Appearance section owns `ui` and writes it separately, so a form Save
  // must not carry a stale copy along and revert it.
  it("omits ui and keeps every section the form renders", () => {
    const patch = toFormPatch(withUi(base, "mono"))
    expect(Object.keys(patch)).toEqual([
      "git",
      "library",
      "orchestration",
      "network",
      "skillGroups",
    ])
    expect(patch).not.toHaveProperty("ui")
    expect(patch.network).toEqual(base.network)
  })
})

describe("formSectionsEqual", () => {
  it("ignores a ui change, so a machine-default write does not read as unsaved edits", () => {
    expect(formSectionsEqual(base, withUi(base, "mono"))).toBe(true)
  })

  it("still catches a change to any editable section", () => {
    expect(
      formSectionsEqual(
        base,
        setField({ settings: base, section: "git", key: "remoteName", raw: "upstream" }),
      ),
    ).toBe(false)
  })
})

describe("reseedDraft", () => {
  const edited = setField({ settings: base, section: "git", key: "defaultBranch", raw: "trunk" })

  it("seeds from stored on first load", () => {
    expect(reseedDraft({ draft: undefined, seeded: undefined, stored: base })).toBe(base)
  })

  it("adopts a new stored value when the draft is untouched since it was seeded", () => {
    const stored = withUi(base, "terminal")
    expect(reseedDraft({ draft: base, seeded: base, stored })).toBe(stored)
  })

  // The case the second writer introduced: something the user was not doing
  // updated the query, and their half-typed branch name must survive it.
  it("keeps a dirty draft rather than discarding edits in progress", () => {
    expect(reseedDraft({ draft: edited, seeded: base, stored: withUi(base, "terminal") })).toBe(
      edited,
    )
  })
})
