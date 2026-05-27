import { describe, expect, it } from "bun:test"
import {
  CatalogParseError,
  LIBRARY_CATEGORIES,
  RequiresCycleError,
  expandHome,
  isSafeSegment,
  parseCatalog,
  parseRequireRef,
  parseSource,
  resolveRequires,
} from "./library.core"

const SAMPLE = `default_dirs:
  skills:
    - default: .claude/skills/
    - global: ~/.claude/skills/
  agents:
    - default: .claude/agents/
    - global: ~/.claude/agents/

library:
  skills:
    - name: align
      description: align skill
      source: https://github.com/Pierre-Mike/agentic/blob/main/skills/align/SKILL.md
    - name: auto-optimize
      description: overnight loop
      source: /Users/me/.claude/skills/auto-optimize/SKILL.md
      requires: [skill:align]
  agents:
    - name: planner
      description: planning agent
      source: /local/agents/planner/AGENT.md
  prompts: []
`

describe("parseCatalog", () => {
  it("parses entries, normalises requires, fills default_dirs", () => {
    const c = parseCatalog(SAMPLE)
    expect(c.entries).toHaveLength(3)
    const align = c.entries.find((e) => e.name === "align")
    expect(align?.type).toBe("skills")
    expect(align?.source.startsWith("https://github.com/")).toBe(true)
    const auto = c.entries.find((e) => e.name === "auto-optimize")
    expect(auto?.requires).toEqual(["skill:align"])
    expect(c.defaultDirs.skills.global).toBe("~/.claude/skills/")
    // Categories absent from yaml still get fallback default_dirs.
    expect(c.defaultDirs.tools.global).toContain(".claude/tools/")
  })

  it("returns empty catalog for empty text", () => {
    const c = parseCatalog("")
    expect(c.entries).toEqual([])
  })

  it("throws CatalogParseError on broken YAML", () => {
    expect(() => parseCatalog(":\n - [not")).toThrow(CatalogParseError)
  })

  it("throws when root is not a mapping", () => {
    expect(() => parseCatalog("- 1\n- 2\n")).toThrow(CatalogParseError)
  })

  it("skips items missing name or source", () => {
    const c = parseCatalog(
      "library:\n  skills:\n    - description: dangling\n    - name: ok\n      source: /tmp/ok/SKILL.md\n      description: ok\n",
    )
    expect(c.entries).toHaveLength(1)
    expect(c.entries[0]?.name).toBe("ok")
  })

  it("covers all six categories", () => {
    expect(LIBRARY_CATEGORIES).toEqual([
      "skills",
      "agents",
      "tools",
      "prompts",
      "statuslines",
      "extensions",
    ])
  })
})

describe("parseRequireRef", () => {
  it("accepts singular and plural prefixes", () => {
    expect(parseRequireRef("skill:align")).toEqual({ category: "skills", name: "align" })
    expect(parseRequireRef("agents:planner")).toEqual({ category: "agents", name: "planner" })
    expect(parseRequireRef("prompt:caption")).toEqual({ category: "prompts", name: "caption" })
  })

  it("rejects malformed refs", () => {
    expect(parseRequireRef("noColon")).toBeNull()
    expect(parseRequireRef(":name")).toBeNull()
    expect(parseRequireRef("skill:")).toBeNull()
    expect(parseRequireRef("bogus:thing")).toBeNull()
  })
})

describe("parseSource", () => {
  const HOME = "/home/me"

  it("expands ~ for local paths", () => {
    const s = parseSource("~/skills/foo/SKILL.md", HOME)
    expect(s?.kind).toBe("local")
    if (s?.kind === "local") {
      expect(s.absPath).toBe("/home/me/skills/foo/SKILL.md")
      expect(s.dir).toBe("/home/me/skills/foo")
    }
  })

  it("parses GitHub blob URLs", () => {
    const s = parseSource(
      "https://github.com/Pierre-Mike/agentic/blob/main/skills/align/SKILL.md",
      HOME,
    )
    expect(s?.kind).toBe("github")
    if (s?.kind === "github") {
      expect(s.org).toBe("Pierre-Mike")
      expect(s.repo).toBe("agentic")
      expect(s.branch).toBe("main")
      expect(s.filePath).toBe("skills/align/SKILL.md")
      expect(s.dir).toBe("skills/align")
      expect(s.cloneUrl).toBe("https://github.com/Pierre-Mike/agentic.git")
    }
  })

  it("parses GitHub raw URLs", () => {
    const s = parseSource("https://raw.githubusercontent.com/org/repo/main/skills/x/SKILL.md", HOME)
    expect(s?.kind).toBe("github")
    if (s?.kind === "github") {
      expect(s.org).toBe("org")
      expect(s.filePath).toBe("skills/x/SKILL.md")
    }
  })

  it("returns null for unrecognised inputs", () => {
    expect(parseSource("not-a-source", "/h")).toBeNull()
    expect(parseSource("http://example.com/file", "/h")).toBeNull()
  })
})

describe("resolveRequires", () => {
  it("returns dependencies before the requested entry", () => {
    const catalog = parseCatalog(SAMPLE)
    const chain = resolveRequires("auto-optimize", catalog)
    expect(chain.map((e) => e.name)).toEqual(["align", "auto-optimize"])
  })

  it("returns just the entry when it has no requires", () => {
    const catalog = parseCatalog(SAMPLE)
    const chain = resolveRequires("align", catalog)
    expect(chain.map((e) => e.name)).toEqual(["align"])
  })

  it("returns empty when the entry is not in the catalog", () => {
    const catalog = parseCatalog(SAMPLE)
    expect(resolveRequires("ghost", catalog)).toEqual([])
  })

  it("ignores unresolvable typed refs", () => {
    const catalog = parseCatalog(
      "library:\n  skills:\n    - name: lonely\n      description: x\n      source: /tmp/lonely/SKILL.md\n      requires: [skill:missing]\n",
    )
    const chain = resolveRequires("lonely", catalog)
    expect(chain.map((e) => e.name)).toEqual(["lonely"])
  })

  it("throws RequiresCycleError on a cycle", () => {
    const cyclic = parseCatalog(
      "library:\n  skills:\n    - name: a\n      description: a\n      source: /a/SKILL.md\n      requires: [skill:b]\n    - name: b\n      description: b\n      source: /b/SKILL.md\n      requires: [skill:a]\n",
    )
    expect(() => resolveRequires("a", cyclic)).toThrow(RequiresCycleError)
  })
})

describe("expandHome / isSafeSegment", () => {
  it("expands ~ prefix", () => {
    expect(expandHome("~/.claude/skills/", "/h")).toBe("/h/.claude/skills/")
    expect(expandHome("/abs/.claude/skills/", "/h")).toBe("/abs/.claude/skills/")
  })
  it("isSafeSegment rejects path-traversal segments", () => {
    expect(isSafeSegment("ok")).toBe(true)
    expect(isSafeSegment("..")).toBe(false)
    expect(isSafeSegment("a/b")).toBe(false)
    expect(isSafeSegment("")).toBe(false)
  })
})
