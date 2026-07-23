import { describe, expect, it } from "bun:test"
import type { SessionState } from "../../lib/types"
import {
  excalidrawCompanionIntent,
  excalidrawMarker,
  isExcalidrawCompanionIntent,
  isLiveExcalidrawCompanion,
} from "./excalidrawPrompt"

const session = (over: Partial<SessionState>): SessionState =>
  ({
    short: "s1",
    state: "working",
    intent: "",
    cwd: "/repo",
    ...over,
  }) as SessionState

describe("excalidrawMarker / isExcalidrawCompanionIntent", () => {
  it("recovers a board's companion from the sessions list by intent prefix", () => {
    const intent = excalidrawCompanionIntent({
      slug: "sketch",
      file: "/p/.pid/b/sketch.excalidraw",
    })
    expect(intent.startsWith(excalidrawMarker("sketch"))).toBe(true)
    expect(isExcalidrawCompanionIntent(intent, "sketch")).toBe(true)
    expect(isExcalidrawCompanionIntent(intent, "other-board")).toBe(false)
  })

  it("does not match V1 brainstorm companions", () => {
    expect(isExcalidrawCompanionIntent("[brainstorm:sketch:review] hi", "sketch")).toBe(false)
  })
})

describe("excalidrawCompanionIntent", () => {
  it("references the file, says we're working on it now, and gives no mission", () => {
    const intent = excalidrawCompanionIntent({
      slug: "sketch",
      file: "/p/.pid/b/sketch.excalidraw",
    })
    expect(intent).toContain("/p/.pid/b/sketch.excalidraw")
    expect(intent).toContain("working on")
    // No V1 role missions: the user drives everything through chat.
    expect(intent).not.toMatch(/Mission:/)
    expect(intent).not.toMatch(/beautify|critique|ideate/i)
  })
})

describe("isLiveExcalidrawCompanion", () => {
  it("counts every state except stopped/failed as live", () => {
    expect(isLiveExcalidrawCompanion(session({ state: "working" }))).toBe(true)
    expect(isLiveExcalidrawCompanion(session({ state: "idle" }))).toBe(true)
    expect(isLiveExcalidrawCompanion(session({ state: "stopped" }))).toBe(false)
    expect(isLiveExcalidrawCompanion(session({ state: "failed" }))).toBe(false)
  })
})
