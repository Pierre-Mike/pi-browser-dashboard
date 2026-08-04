import { describe, expect, it } from "bun:test"
import { briefingMessage, type CanvasFormat } from "./canvasBriefing"

const ALL_FORMATS: readonly CanvasFormat[] = ["jsonCanvas", "reactFlow", "excalidraw"]

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

  it("describes the Excalidraw scene shape for a .excalidraw board", () => {
    // The third editor had no briefing at all: its board could only be told
    // about by hand, so the agent guessed a canvas encoding and wrote a file
    // the Excalidraw editor then refused to restore.
    const msg = briefingMessage({ path: "a.excalidraw", format: "excalidraw" })
    expect(msg).toContain("Excalidraw")
    expect(msg).toContain('"elements"')
    expect(msg).not.toContain("fromNode")
    expect(msg).not.toContain("position:{x,y}")
  })

  it("tells the agent the browser syncs live and to re-read before writing", () => {
    for (const format of ALL_FORMATS) {
      const msg = briefingMessage({ path: "board", format })
      expect(msg).toContain("syncs live")
      expect(msg).toContain("re-read the file before every write")
    }
  })

  it("frames the work as a shared brainstorm session, whichever editor is open", () => {
    // This is the message a session gets when the human opens a board beside
    // its terminal, so it has to say what is happening — the agent has no other
    // signal that a drawing just appeared in its worktree.
    for (const format of ALL_FORMATS) {
      expect(briefingMessage({ path: "board", format })).toContain("brainstorm")
    }
  })

  it("points replies at the terminal, since there is no chat pane any more", () => {
    for (const format of ALL_FORMATS) {
      const msg = briefingMessage({ path: "board", format })
      expect(msg).not.toContain("in chat")
      expect(msg).not.toContain("chat tab")
    }
  })
})
