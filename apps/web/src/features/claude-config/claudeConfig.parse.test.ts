import { describe, expect, it } from "bun:test"
import { parseScopeBundle, parseSkillDetail } from "./claudeConfig.parse"
import type { ScopeBundle, SkillDetail } from "./types"

const minimalBundle: ScopeBundle = {
  scope: "global",
  root: "/home/u/.claude",
  skills: [],
  hookScripts: [],
  hooks: [],
}

describe("parseScopeBundle", () => {
  it("accepts the minimal shape (no settings, no claudeMd)", () => {
    expect(parseScopeBundle(minimalBundle)).toEqual(minimalBundle)
  })

  it("accepts a full bundle with settings, skills, and hook scripts", () => {
    const full: ScopeBundle = {
      scope: "project",
      root: "/repo/.claude",
      claudeMd: "# Project notes",
      settings: {
        hooks: [{ event: "PreToolUse", command: "echo hi" }],
        permissions: { allow: ["Bash(ls:*)"], defaultMode: "default" },
        theme: "dark",
        extras: { unknownKey: 1 },
        raw: "{}",
      },
      skills: [{ id: "s1", path: "skills/s1", name: "s1", bytes: 100, hasEvals: true }],
      hookScripts: [{ name: "pre.sh", path: "hooks/pre.sh", bytes: 40 }],
      hooks: [{ event: "PreToolUse", command: "echo hi" }],
    }
    expect(parseScopeBundle(full)).toEqual(full)
  })

  it("rejects an unrecognized scope", () => {
    expect(parseScopeBundle({ ...minimalBundle, scope: "user" })).toBeNull()
  })

  it("rejects a malformed skill in the list", () => {
    expect(parseScopeBundle({ ...minimalBundle, skills: [{ id: "s1" }] })).toBeNull()
  })

  it("rejects a malformed nested settings object", () => {
    expect(
      parseScopeBundle({
        ...minimalBundle,
        settings: { hooks: [], extras: {}, raw: "{}", theme: 1 },
      }),
    ).toBeNull()
  })

  it("rejects a non-object", () => {
    expect(parseScopeBundle(null)).toBeNull()
  })
})

describe("parseSkillDetail", () => {
  const detail: SkillDetail = {
    id: "s1",
    path: "skills/s1",
    name: "s1",
    bytes: 100,
    hasEvals: false,
    body: "# s1\n\nDo the thing.",
    frontmatter: { name: "s1", description: "does the thing" },
  }

  it("accepts a well-formed skill detail", () => {
    expect(parseSkillDetail(detail)).toEqual(detail)
  })

  it("accepts an empty frontmatter", () => {
    expect(parseSkillDetail({ ...detail, frontmatter: {} })?.frontmatter).toEqual({
      name: undefined,
      description: undefined,
      metadata: undefined,
    })
  })

  it("rejects a missing body", () => {
    const { body, ...rest } = detail
    expect(parseSkillDetail(rest)).toBeNull()
  })

  it("rejects a non-object frontmatter", () => {
    expect(parseSkillDetail({ ...detail, frontmatter: "none" })).toBeNull()
  })
})
