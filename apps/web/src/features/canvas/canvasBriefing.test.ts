import { describe, expect, it } from "bun:test"
import { briefingMessage } from "./canvasBriefing"

describe("briefingMessage", () => {
  it("names the exact file the agent must read and write", () => {
    const msg = briefingMessage({ path: "/tmp/wt/brainstorms/auth.canvas", format: "jsonCanvas" })
    expect(msg).toContain("/tmp/wt/brainstorms/auth.canvas")
  })

  it("describes the Obsidian shape for a .canvas board — never the React-Flow one", () => {
    const msg = briefingMessage({ path: "a.canvas", format: "jsonCanvas" })
    expect(msg).toContain("JSON Canvas")
    expect(msg).toContain("fromNode")
    expect(msg).not.toContain("position:{x,y}")
  })

  it("describes the React-Flow shape for a legacy board or a session canvas", () => {
    const msg = briefingMessage({ path: "a.canvas.json", format: "reactFlow" })
    expect(msg).toContain("React-Flow")
    expect(msg).toContain("position:{x,y}")
    expect(msg).not.toContain("fromNode")
  })

  it("tells the agent the browser syncs live and to re-read before writing", () => {
    const msg = briefingMessage({ path: "a.canvas", format: "jsonCanvas" })
    expect(msg).toContain("syncs live")
    expect(msg).toContain("re-read the file before every write")
  })
})
