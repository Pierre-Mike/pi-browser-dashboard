import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

// Interactive behavior is covered by Playwright e2e; here we lock the key
// invariants at the source level (repo's src-text test convention — see
// NewPidAppButton.test.ts).
const src = readFileSync(join(import.meta.dir, "NewBrainstormButton.tsx"), "utf8")

describe("NewBrainstormButton source invariants", () => {
  it("exposes a per-format control in the left rail (canvas keeps the historical testid)", () => {
    expect(src).toContain('"brainstorm-new"')
    expect(src).toContain('"brainstorm-new-excalidraw"')
  })

  it("defaults to the .canvas format so the plain + button creates a JSON Canvas board", () => {
    expect(src).toContain('kind = "canvas"')
  })

  it("uses local component state for the inline name input, never a blocking window.prompt", () => {
    expect(src).toContain("useState")
    expect(src).not.toContain("window.prompt")
  })

  it("creates the document in the session's worktree, with name + format", () => {
    expect(src).toContain("useCreateBrainstorm(short)")
    expect(src).toContain("create.mutate(")
    expect(src).toContain("{ name: trimmed, kind }")
  })

  it("switches to the new board by path — boards are identified by where they live", () => {
    expect(src).toContain("onCreated(doc.path)")
  })
})
