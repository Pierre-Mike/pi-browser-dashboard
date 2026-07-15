import { describe, expect, it } from "bun:test"
import type { SessionState } from "../../lib/types"
import {
  COMPANION_ROLES,
  companionIntent,
  companionMarker,
  companionRoleFromIntent,
  companionRoleSpec,
  companionToggle,
  isCompanionIntent,
  isLiveCompanion,
  runningCompanion,
} from "./brainstormPrompts"

const FILE = "/tmp/proj/.pid/brainstorms/auth-flow.canvas.json"

// Minimal SessionState builder for the roster/toggle helpers — only the fields
// the pure functions read (short, state, intent) matter here.
const companion = (
  short: string,
  opts: { role: string; state?: SessionState["state"] },
): SessionState =>
  ({
    short,
    state: opts.state ?? "working",
    intent: `[brainstorm:auth-flow:${opts.role}] mission…`,
  }) as SessionState

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

describe("isLiveCompanion", () => {
  it("counts a companion as live until it is stopped or failed", () => {
    for (const state of ["working", "idle", "done", "blocked", "needs_input"] as const) {
      expect(isLiveCompanion(companion("a", { role: "review", state }))).toBe(true)
    }
    expect(isLiveCompanion(companion("a", { role: "review", state: "stopped" }))).toBe(false)
    expect(isLiveCompanion(companion("a", { role: "review", state: "failed" }))).toBe(false)
  })
})

describe("runningCompanion", () => {
  it("finds the live companion filling a role, ignoring dead ones", () => {
    const roster = [
      companion("dead", { role: "review", state: "stopped" }),
      companion("live", { role: "review" }),
      companion("other", { role: "ideate" }),
    ]
    expect(runningCompanion(roster, "review")?.short).toBe("live")
    expect(runningCompanion(roster, "ideate")?.short).toBe("other")
    expect(runningCompanion(roster, "critique")).toBeUndefined()
  })

  it("treats a role whose only companion is dead as empty", () => {
    const dead = [companion("x", { role: "beautify", state: "failed" })]
    expect(runningCompanion(dead, "beautify")).toBeUndefined()
  })
})

describe("companionToggle", () => {
  it("spawns when the role has no live companion (select)", () => {
    expect(companionToggle([], "review")).toEqual({ kind: "spawn", role: "review" })
    // A dead companion doesn't block a fresh spawn.
    const dead = [companion("x", { role: "review", state: "stopped" })]
    expect(companionToggle(dead, "review")).toEqual({ kind: "spawn", role: "review" })
  })

  it("stops the live companion when the role is already filled (unselect)", () => {
    const roster = [companion("live", { role: "critique" })]
    expect(companionToggle(roster, "critique")).toEqual({
      kind: "stop",
      role: "critique",
      short: "live",
    })
  })
})
