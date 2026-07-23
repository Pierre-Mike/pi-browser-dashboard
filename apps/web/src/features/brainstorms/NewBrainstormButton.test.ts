import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

// Interactive behavior is covered by Playwright e2e; here we lock the key
// invariants at the source level (repo's src-text test convention — see
// NewPidAppButton.test.ts).
const src = readFileSync(join(import.meta.dir, "NewBrainstormButton.tsx"), "utf8")

describe("NewBrainstormButton source invariants", () => {
  it("exposes a per-kind control in the left rail (canvas keeps the historical testid)", () => {
    expect(src).toContain('"brainstorm-new"')
    expect(src).toContain('"brainstorm-new-excalidraw"')
  })

  it("defaults to the V1 canvas kind so existing call sites are unchanged", () => {
    expect(src).toContain('kind = "canvas"')
  })

  it("uses local component state for the inline name input, never a blocking window.prompt", () => {
    expect(src).toContain("useState")
    expect(src).not.toContain("window.prompt")
  })

  it("creates the document via useCreateBrainstorm and mutates with name + kind", () => {
    expect(src).toContain("useCreateBrainstorm(projectId)")
    expect(src).toContain("create.mutate(")
    expect(src).toContain("{ name: trimmed, kind }")
  })

  it("switches to the newly created board on success", () => {
    expect(src).toContain("onCreated(doc.id)")
  })
})
