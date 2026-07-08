import { describe, expect, it } from "bun:test"
import {
  COMPANION_ROLES,
  companionIntent,
  companionMarker,
  companionNudge,
  companionRoleFromIntent,
  companionRoleSpec,
  isCompanionIntent,
} from "./brainstormPrompts"

const FILE = "/tmp/proj/.pid/brainstorms/auth-flow.canvas.json"

describe("companion marker / roster recovery", () => {
  it("prefixes every intent with the slug+role marker so sessions self-identify", () => {
    for (const spec of COMPANION_ROLES) {
      const intent = companionIntent({ role: spec.role, slug: "auth-flow", file: FILE })
      expect(intent.startsWith(`[brainstorm:auth-flow:${spec.role}]`)).toBe(true)
      expect(isCompanionIntent(intent, "auth-flow")).toBe(true)
      expect(isCompanionIntent(intent, "other")).toBe(false)
      expect(companionRoleFromIntent(intent)).toBe(spec.role)
    }
  })

  it("marker is stable and slug-scoped; unknown roles resolve to null", () => {
    expect(companionMarker("x", "review")).toBe("[brainstorm:x:review]")
    expect(companionRoleFromIntent("[brainstorm:x:hacker] hi")).toBe(null)
    expect(companionRoleFromIntent("fix the login bug")).toBe(null)
  })

  it("a slug that prefixes another slug never claims its sessions", () => {
    const intent = companionIntent({ role: "review", slug: "auth-flow-v2", file: FILE })
    expect(isCompanionIntent(intent, "auth-flow")).toBe(false)
  })
})

describe("companionIntent", () => {
  it("embeds the document path and the live-sync contract", () => {
    const intent = companionIntent({ role: "review", slug: "auth-flow", file: FILE })
    expect(intent).toContain(FILE)
    expect(intent).toContain("updates LIVE")
    expect(intent).toContain("re-read the file")
  })

  it("review is read-only; writing roles are non-destructive", () => {
    expect(companionIntent({ role: "review", slug: "s", file: FILE })).toContain(
      "do NOT modify the file",
    )
    for (const role of ["beautify", "critique", "ideate"] as const) {
      const flat = companionIntent({ role, slug: "s", file: FILE }).replace(/\s+/g, " ")
      expect(flat).toMatch(/delete the user's (own )?nodes/)
    }
  })

  it("critique adds colored NOTE boxes; ideate adds green idea boxes", () => {
    const critique = companionIntent({ role: "critique", slug: "s", file: FILE })
    expect(critique).toContain('"NOTE: ')
    expect(critique).toContain('"1"')
    const ideate = companionIntent({ role: "ideate", slug: "s", file: FILE })
    expect(ideate).toContain('"4"')
  })

  it("appends the user's freeform note when provided", () => {
    const intent = companionIntent({
      role: "ideate",
      slug: "s",
      file: FILE,
      extra: "  focus on the login path  ",
    })
    expect(intent).toContain("User's note: focus on the login path")
    expect(companionIntent({ role: "ideate", slug: "s", file: FILE, extra: "  " })).not.toContain(
      "User's note:",
    )
  })

  it("throws on an unknown role instead of spawning a mission-less agent", () => {
    expect(() => companionRoleSpec("nope" as never)).toThrow()
  })
})

describe("companionNudge", () => {
  it("points the running companion back at the file", () => {
    expect(companionNudge(FILE, "")).toBe(
      `I updated the drawing — re-read ${FILE} and continue your mission.`,
    )
  })

  it("carries an optional user note", () => {
    expect(companionNudge(FILE, " check the DB box ")).toContain("Also: check the DB box")
  })
})
