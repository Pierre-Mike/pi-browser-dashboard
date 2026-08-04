import { describe, expect, it } from "bun:test"
import {
  type Brainstorm,
  boardPathFromTabKey,
  boardTabKey,
  brainstormEditorFor,
  brainstormsQueryKey,
  briefFormatFor,
  selectedBoard,
} from "./brainstorms"

const board = (path: string): Brainstorm => ({
  path,
  label: path,
  kind: "canvas",
  file: `/tmp/wt/${path}`,
  updatedAt: "2026-07-28T00:00:00.000Z",
})

describe("brainstormsQueryKey", () => {
  it("scopes the cache to one session", () => {
    expect(brainstormsQueryKey("abc123")).toEqual(["brainstorms", "abc123"])
    expect(brainstormsQueryKey("abc123")).not.toEqual(brainstormsQueryKey("def456"))
  })
})

describe("brainstormEditorFor", () => {
  it("opens both canvas encodings in the canvas editor", () => {
    expect(brainstormEditorFor("canvas")).toBe("canvas")
    expect(brainstormEditorFor("canvasJson")).toBe("canvas")
    expect(brainstormEditorFor("excalidraw")).toBe("excalidraw")
  })
})

describe("briefFormatFor", () => {
  it("maps each on-disk kind to the wire shape its briefing must describe", () => {
    // Getting this wrong means the agent writes a file the open editor cannot
    // decode — the exact failure the briefing exists to prevent.
    expect(briefFormatFor("canvas")).toBe("jsonCanvas")
    expect(briefFormatFor("canvasJson")).toBe("reactFlow")
    expect(briefFormatFor("excalidraw")).toBe("excalidraw")
  })
})

describe("board tab keys", () => {
  it("round-trips a nested path through the tab param", () => {
    const path = "brainstorms/q3/plan.canvas"
    expect(boardPathFromTabKey(boardTabKey(path))).toBe(path)
  })

  it("encodes the separators rather than trusting the router with them", () => {
    expect(boardTabKey("a/b.canvas")).toBe("brainstorm:a%2Fb.canvas")
  })

  it("is empty for the bare tab and for a malformed encoding", () => {
    expect(boardPathFromTabKey("brainstorm")).toBe("")
    expect(boardPathFromTabKey("terminal")).toBe("")
    expect(boardPathFromTabKey("brainstorm:%E0%A4%A")).toBe("")
  })
})

describe("selectedBoard", () => {
  const boards = [board("brainstorms/a.canvas"), board("docs/b.canvas")]

  it("selects the board the tab names", () => {
    const tab = boardTabKey("docs/b.canvas")
    expect(selectedBoard({ boards, tab })?.path).toBe("docs/b.canvas")
  })

  it("falls back to the first board for a bare tab or a vanished path", () => {
    expect(selectedBoard({ boards, tab: "brainstorm" })?.path).toBe("brainstorms/a.canvas")
    expect(selectedBoard({ boards, tab: boardTabKey("gone.canvas") })?.path).toBe(
      "brainstorms/a.canvas",
    )
  })

  it("is null when the worktree has no boards", () => {
    expect(selectedBoard({ boards: [], tab: "brainstorm" })).toBeNull()
  })
})
