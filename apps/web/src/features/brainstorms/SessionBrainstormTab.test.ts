import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

// The section mounts a live boards query and a websocket-bound editor, so it is
// checked structurally like the other shells in this app.
const src = readFileSync(join(import.meta.dir, "SessionBrainstormTab.tsx"), "utf8")

describe("session brainstorm section", () => {
  it("keeps the empty-state sentence inside one flex child", () => {
    // Written directly inside the `flex` box, every text run and every <span>
    // becomes its own flex ITEM and the copy renders as evenly-spaced columns
    // instead of a wrapped sentence. Page-wide that was hard to notice; docked
    // as a side pane beside the terminal it is the first thing you see.
    const emptyState = src.slice(src.indexOf("const EmptyState"), src.indexOf("const BoardRail"))
    expect(emptyState).toContain("<p className=")
    expect(emptyState).toMatch(/<div className="flex[^"]*">\s*<p /)
    // The type-setting classes belong to the paragraph, not the flex container.
    expect(emptyState).not.toMatch(/<div className="flex[^"]*text-center/)
  })

  it("renders the boards rail beside the selected board, both shrinkable", () => {
    // `min-w-0` on the row is what lets the editor track the pane it was given
    // rather than its own (much wider) intrinsic size.
    expect(src).toContain("min-w-0")
    expect(src).toContain("<BoardRail")
    expect(src).toContain("<SessionBoardPanel")
  })

  it("paints with semantic tokens, not the raw Tailwind palette", () => {
    for (const raw of ["slate-", "amber-", "rose-", "dark:"]) expect(src).not.toContain(raw)
  })
})
