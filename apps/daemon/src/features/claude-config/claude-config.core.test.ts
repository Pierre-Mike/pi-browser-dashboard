import { describe, expect, it } from "bun:test"
import {
  flattenHooks,
  isSafeSegment,
  parseSettings,
  parseSkillFrontmatter,
} from "./claude-config.core"

describe("flattenHooks", () => {
  it("returns empty for non-object input", () => {
    expect(flattenHooks(null)).toEqual([])
    expect(flattenHooks(undefined)).toEqual([])
    expect(flattenHooks("nope")).toEqual([])
    expect(flattenHooks([])).toEqual([])
  })

  it("flattens a typical settings.hooks block", () => {
    const out = flattenHooks({
      Stop: [
        {
          hooks: [
            { type: "command", command: "echo hi", timeout: 5 },
            { type: "command", command: "echo bye", async: true, statusMessage: "running" },
          ],
        },
      ],
      PreToolUse: [
        {
          matcher: "Bash",
          hooks: [{ type: "command", command: "rtk hook claude" }],
        },
      ],
    })
    expect(out).toHaveLength(3)
    expect(out[0]).toEqual({ event: "Stop", command: "echo hi", type: "command", timeout: 5 })
    expect(out[1]).toMatchObject({ event: "Stop", async: true, statusMessage: "running" })
    expect(out[2]).toEqual({
      event: "PreToolUse",
      matcher: "Bash",
      command: "rtk hook claude",
      type: "command",
    })
  })

  it("skips malformed entries silently", () => {
    const out = flattenHooks({
      Stop: [{ hooks: [{ command: "" }, { type: "command" }, { type: "command", command: "ok" }] }],
      Notification: "not-an-array",
    })
    expect(out).toEqual([{ event: "Stop", command: "ok", type: "command" }])
  })
})

describe("parseSettings", () => {
  it("parses a minimal settings.json", () => {
    const s = parseSettings(JSON.stringify({ theme: "auto", hooks: {} }))
    expect(s.parseError).toBeUndefined()
    expect(s.theme).toBe("auto")
    expect(s.hooks).toEqual([])
  })

  it("extracts permissions and hooks", () => {
    const s = parseSettings(
      JSON.stringify({
        permissions: { allow: ["Bash(ls:*)"], defaultMode: "auto" },
        hooks: { Stop: [{ hooks: [{ type: "command", command: "x" }] }] },
      }),
    )
    expect(s.permissions?.allow).toEqual(["Bash(ls:*)"])
    expect(s.permissions?.defaultMode).toBe("auto")
    expect(s.hooks).toHaveLength(1)
  })

  it("captures parseError but preserves raw text", () => {
    const s = parseSettings("{not json")
    expect(s.parseError).toBeDefined()
    expect(s.raw).toBe("{not json")
  })

  it("handles empty file as empty config", () => {
    const s = parseSettings("")
    expect(s.parseError).toBeUndefined()
    expect(s.hooks).toEqual([])
  })

  it("collects unknown keys into extras", () => {
    const s = parseSettings(JSON.stringify({ voice: { enabled: true }, hooks: {} }))
    expect(s.extras.voice).toEqual({ enabled: true })
  })
})

describe("parseSkillFrontmatter", () => {
  it("extracts name and description", () => {
    const text = `---
name: concise
description: Compress output
---
body line one
body line two
`
    const { frontmatter, body } = parseSkillFrontmatter(text)
    expect(frontmatter.name).toBe("concise")
    expect(frontmatter.description).toBe("Compress output")
    expect(body.trim()).toBe("body line one\nbody line two")
  })

  it("supports a metadata block", () => {
    const text = `---
name: x
metadata:
  type: feedback
  scope: project
---
b
`
    const { frontmatter } = parseSkillFrontmatter(text)
    expect(frontmatter.metadata).toEqual({ type: "feedback", scope: "project" })
  })

  it("returns empty frontmatter for plain markdown", () => {
    const { frontmatter, body } = parseSkillFrontmatter("# heading\nhi\n")
    expect(frontmatter).toEqual({})
    expect(body).toBe("# heading\nhi\n")
  })

  it("returns empty frontmatter when block is unterminated", () => {
    const { frontmatter, body } = parseSkillFrontmatter("---\nname: x\nbody without close")
    expect(frontmatter).toEqual({})
    expect(body.startsWith("---")).toBe(true)
  })

  it("strips surrounding quotes from values", () => {
    const text = `---
name: "quoted"
description: 'single'
---
`
    const { frontmatter } = parseSkillFrontmatter(text)
    expect(frontmatter.name).toBe("quoted")
    expect(frontmatter.description).toBe("single")
  })
})

describe("isSafeSegment", () => {
  it("accepts normal ids", () => {
    expect(isSafeSegment("concise")).toBe(true)
    expect(isSafeSegment("claude-p")).toBe(true)
    expect(isSafeSegment("a.b.c")).toBe(true)
  })
  it("rejects dotfiles, slashes, NUL", () => {
    expect(isSafeSegment(".hidden")).toBe(false)
    expect(isSafeSegment("a/b")).toBe(false)
    expect(isSafeSegment("a\\b")).toBe(false)
    expect(isSafeSegment("a\0b")).toBe(false)
    expect(isSafeSegment("")).toBe(false)
  })
})
