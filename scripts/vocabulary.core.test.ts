/**
 * Every fixture below uses an INVENTED vocabulary — Widget/gizmo, Sprocket/cog
 * — never this repo's real one.
 *
 * That is not a style choice. This gate reads every tracked file, including
 * this one, so a fixture spelled with a genuinely avoided word makes the test
 * suite fail the gate it is testing. It was written with real terms first and
 * the pre-commit hook caught it: fourteen violations, all of them here. Same
 * self-reference defect `AGENTS.md` records for the screen matchers, where the
 * docs describing a matcher started matching as one.
 *
 * The invented vocabulary is better testing anyway — it decouples these tests
 * from AGENTS.md, so editing the glossary cannot turn them red.
 */
import { describe, expect, it } from "bun:test"
import {
  checkContent,
  formatRule,
  formatViolation,
  isLintable,
  parseRules,
  type VocabRule,
} from "./vocabulary.core"

const glossary = (body: string): string =>
  `# Title\n\nintro\n\n## Domain\n\n${body}\n\n## Next\n\nafter\n`

const rulesFrom = (body: string): readonly VocabRule[] =>
  parseRules({ markdown: glossary(body), sourceFile: "AGENTS.md" })

const WIDGET = "**Widget**:\nA thing that turns.\n_Avoid_: gizmo, doohickey"

describe("parseRules", () => {
  it("reads a term's avoided list and attributes it to that term", () => {
    expect(rulesFrom(WIDGET)).toEqual([
      { avoid: "gizmo", canonical: "Widget", scopeDir: "", sourceFile: "AGENTS.md" },
      { avoid: "doohickey", canonical: "Widget", scopeDir: "", sourceFile: "AGENTS.md" },
    ])
  })

  it("returns nothing for a file with no ## Domain section", () => {
    expect(
      parseRules({ markdown: "# Title\n\n## Other\n\n_Avoid_: gizmo", sourceFile: "AGENTS.md" }),
    ).toEqual([])
  })

  it("stops at the next h2 so a later section's prose is not parsed as terms", () => {
    const rules = parseRules({
      markdown: `## Domain\n\n${WIDGET}\n\n## Decisions\n\n**Nope**:\n_Avoid_: leaked`,
      sourceFile: "AGENTS.md",
    })
    expect(rules.map((rule) => rule.avoid)).toEqual(["gizmo", "doohickey"])
  })

  it("keeps a deeper h3 heading inside the section", () => {
    expect(rulesFrom(`### Group\n\n${WIDGET}`).map((rule) => rule.canonical)).toEqual([
      "Widget",
      "Widget",
    ])
  })

  it("scopes a nested glossary to its own directory", () => {
    const rules = parseRules({ markdown: glossary(WIDGET), sourceFile: "apps/web/AGENTS.md" })
    expect(rules[0]?.scopeDir).toBe("apps/web")
  })

  it("drops an avoided word that is also a term name, rather than flagging the canonical term", () => {
    const rules = rulesFrom("**Sprocket**:\nA toothed wheel.\n_Avoid_: sprocket, cog")
    expect(rules.map((rule) => rule.avoid)).toEqual(["cog"])
  })

  it("ignores an _Avoid_ line that precedes any term", () => {
    expect(rulesFrom("_Avoid_: orphan\n\n**Widget**:\nA thing.")).toEqual([])
  })

  it("normalizes case and punctuation in the avoided list", () => {
    expect(rulesFrom("**Widget**:\nA thing.\n_Avoid_: Bent-Gizmo")[0]?.avoid).toBe("bent gizmo")
  })

  it("attributes each avoided list to the term above it, not the first term", () => {
    const rules = rulesFrom(`${WIDGET}\n\n**Sprocket**:\nA wheel.\n_Avoid_: cog`)
    expect(rules.map((rule) => [rule.canonical, rule.avoid])).toEqual([
      ["Widget", "gizmo"],
      ["Widget", "doohickey"],
      ["Sprocket", "cog"],
    ])
  })
})

describe("checkContent", () => {
  const rules = rulesFrom(WIDGET)

  it("flags an avoided term in prose, with its line number", () => {
    expect(
      checkContent({ file: "doc/notes.md", content: "fine line\ncheck the gizmo first\n", rules }),
    ).toEqual([
      {
        file: "doc/notes.md",
        line: 2,
        avoided: "gizmo",
        canonical: "Widget",
        sourceFile: "AGENTS.md",
      },
    ])
  })

  it("flags the same term spelled as an identifier, in any case convention", () => {
    for (const content of ["const gizmoCount = 1", "const gizmo_count = 1", "<GizmoPanel />"]) {
      expect(checkContent({ file: "a.tsx", content, rules })).toHaveLength(1)
    }
  })

  it("matches whole words only, so a longer word does not trip it", () => {
    expect(checkContent({ file: "a.ts", content: "const gizmos = 1", rules })).toEqual([])
  })

  it("does not flag a glossary's own _Avoid_ line", () => {
    expect(checkContent({ file: "doc/copy.md", content: "_Avoid_: gizmo", rules })).toEqual([])
  })

  it("applies a scoped rule inside its subtree and nowhere else", () => {
    const scoped = parseRules({ markdown: glossary(WIDGET), sourceFile: "apps/web/AGENTS.md" })
    expect(
      checkContent({ file: "apps/web/src/a.ts", content: "// a gizmo", rules: scoped }),
    ).toHaveLength(1)
    expect(
      checkContent({ file: "apps/daemon/src/a.ts", content: "// a gizmo", rules: scoped }),
    ).toEqual([])
  })

  it("does not treat a sibling directory with a shared prefix as in scope", () => {
    const scoped = parseRules({ markdown: glossary(WIDGET), sourceFile: "apps/web/AGENTS.md" })
    expect(
      checkContent({ file: "apps/web-legacy/a.ts", content: "// a gizmo", rules: scoped }),
    ).toEqual([])
  })

  it("reports every distinct avoided term on one line", () => {
    const found = checkContent({ file: "a.md", content: "the gizmo and the doohickey", rules })
    expect(found.map((violation) => violation.avoided)).toEqual(["gizmo", "doohickey"])
  })

  it("is a no-op when no rule binds the file", () => {
    expect(checkContent({ file: "a.ts", content: "gizmo", rules: [] })).toEqual([])
  })
})

describe("isLintable", () => {
  it("accepts source and prose that could carry the vocabulary", () => {
    for (const file of ["a.ts", "a.tsx", "doc/b.md", "c.sh", "d.yml"]) {
      expect(isLintable(file)).toBe(true)
    }
  })

  it("skips the glossaries themselves, wherever they sit", () => {
    expect(isLintable("AGENTS.md")).toBe(false)
    expect(isLintable("apps/web/CLAUDE.md")).toBe(false)
  })

  it("skips ADRs and vendored dependencies", () => {
    expect(isLintable("docs/adr/0001-thing.md")).toBe(false)
    expect(isLintable("node_modules/pkg/index.ts")).toBe(false)
  })

  it("skips a file with no extension it knows", () => {
    expect(isLintable("Makefile")).toBe(false)
    expect(isLintable("a.png")).toBe(false)
  })
})

describe("formatting", () => {
  it("prints a violation as file:line with both spellings", () => {
    const [violation] = checkContent({
      file: "a.ts",
      content: "const gizmoCount = 1",
      rules: rulesFrom(WIDGET),
    })
    expect(violation && formatViolation(violation)).toBe(
      'a.ts:1  "gizmo" → use "Widget"  (AGENTS.md)',
    )
  })

  it("labels a root rule's scope readably", () => {
    const [rule] = rulesFrom(WIDGET)
    expect(rule && formatRule(rule)).toContain("[scope: (repo root), from AGENTS.md]")
  })
})
