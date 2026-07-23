import { describe, expect, it } from "bun:test"
import type { SessionState } from "../../lib/types"
import {
  brainstormCompanionIntent,
  brainstormMarker,
  isBrainstormCompanionIntent,
  isLiveBrainstormCompanion,
} from "./brainstormPrompts"

const FILE = "/tmp/proj/.pid/brainstorms/auth-flow.canvas.json"

const session = (over: Partial<SessionState>): SessionState =>
  ({
    short: "s1",
    state: "working",
    intent: "",
    cwd: "/repo",
    ...over,
  }) as SessionState

describe("brainstormMarker / isBrainstormCompanionIntent", () => {
  it("recovers a board's companion from the sessions list by intent prefix", () => {
    const intent = brainstormCompanionIntent({ slug: "auth-flow", file: FILE })
    expect(intent.startsWith(brainstormMarker("auth-flow"))).toBe(true)
    expect(isBrainstormCompanionIntent(intent, "auth-flow")).toBe(true)
    expect(isBrainstormCompanionIntent(intent, "other-board")).toBe(false)
  })

  it("marker is stable and slug-scoped", () => {
    expect(brainstormMarker("x")).toBe("[brainstorm:x]")
  })

  it("a slug that prefixes another slug never claims its sessions", () => {
    const intent = brainstormCompanionIntent({ slug: "auth-flow-v2", file: FILE })
    expect(isBrainstormCompanionIntent(intent, "auth-flow")).toBe(false)
  })

  it("does not match V2 excalidraw companions", () => {
    expect(isBrainstormCompanionIntent("[excalidraw:auth-flow] hi", "auth-flow")).toBe(false)
  })
})

describe("brainstormCompanionIntent", () => {
  it("references the file, says we're working on it now, and gives no mission or role", () => {
    const intent = brainstormCompanionIntent({ slug: "auth-flow", file: FILE })
    expect(intent).toContain(FILE)
    expect(intent).toContain("working on")
    // No V1 role missions: the user drives everything through chat.
    expect(intent).not.toMatch(/Mission:/)
    expect(intent).not.toMatch(/beautify|critique|ideate/i)
  })

  it("embeds the live-sync contract so the agent re-reads before each write", () => {
    const intent = brainstormCompanionIntent({ slug: "s", file: FILE })
    expect(intent).toContain("updates LIVE")
    expect(intent).toContain("re-read the file")
  })
})

describe("isLiveBrainstormCompanion", () => {
  it("counts every state except stopped/failed as live", () => {
    for (const state of ["working", "idle", "done", "blocked", "needs_input"] as const) {
      expect(isLiveBrainstormCompanion(session({ state }))).toBe(true)
    }
    expect(isLiveBrainstormCompanion(session({ state: "stopped" }))).toBe(false)
    expect(isLiveBrainstormCompanion(session({ state: "failed" }))).toBe(false)
  })
})
