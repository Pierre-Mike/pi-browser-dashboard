import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

// Interactive behavior is covered by Playwright e2e; here we lock the key
// invariants at the source level (repo's src-text test convention — see
// NewPidAppButton.test.ts).
const src = readFileSync(join(import.meta.dir, "NewBrainstormButton.tsx"), "utf8")

describe("NewBrainstormButton source invariants", () => {
  it("exposes the '+' control in the left rail", () => {
    expect(src).toContain('data-testid="brainstorm-new"')
  })

  it("uses local component state for the inline name input, never a blocking window.prompt", () => {
    expect(src).toContain("useState")
    expect(src).not.toContain("window.prompt")
  })

  it("creates the document via useCreateBrainstorm and mutates with the entered name", () => {
    expect(src).toContain("useCreateBrainstorm(projectId)")
    expect(src).toContain("create.mutate(")
  })

  it("switches to the newly created board on success", () => {
    expect(src).toContain("onCreated(doc.id)")
  })
})
