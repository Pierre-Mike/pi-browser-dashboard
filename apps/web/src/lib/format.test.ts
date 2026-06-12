import { describe, expect, it } from "bun:test"
import { stateColor, stateTitle } from "./format"

describe("stateTitle", () => {
  it("returns the human label when there is no detail", () => {
    expect(stateTitle("done", "")).toBe("Done")
    expect(stateTitle("failed", "   ")).toBe("Failed")
    expect(stateTitle("idle", "")).toBe("Idle")
    expect(stateTitle("stopped", "")).toBe("Stopped")
  })

  it("combines the label with detail so hover explains the status", () => {
    expect(stateTitle("failed", "exited code 1")).toBe("Failed — exited code 1")
    expect(stateTitle("done", "all tests passed")).toBe("Done — all tests passed")
  })

  it("trims surrounding whitespace from detail", () => {
    expect(stateTitle("working", "  building  ")).toBe("Working — building")
  })

  it("uses the same label the palette exposes", () => {
    expect(stateTitle("needs_input", "")).toBe(stateColor("needs_input").label)
  })

  it("renders 'blocked' as its own state, not the idle fallback", () => {
    const blocked = stateColor("blocked")
    expect(blocked.label).toBe("Blocked")
    expect(blocked).not.toBe(stateColor("idle"))
    expect(stateTitle("blocked", "waiting for review")).toBe("Blocked — waiting for review")
  })
})
