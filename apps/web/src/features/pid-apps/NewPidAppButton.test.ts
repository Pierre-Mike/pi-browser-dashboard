import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

// The component's interactive behavior is covered by Playwright e2e in a later
// phase; here we lock its key invariants at the source level (repo's src-text
// test convention — see PidAppHost.test.ts / usePidApps.test.ts).
const src = readFileSync(join(import.meta.dir, "NewPidAppButton.tsx"), "utf8")

describe("NewPidAppButton source invariants", () => {
  it("exposes the '+' control after the tab list", () => {
    expect(src).toContain('data-testid="pid-app-new"')
  })

  it("uses local component state for the inline name input, never a blocking window.prompt", () => {
    expect(src).toContain("useState")
    expect(src).not.toContain("window.prompt")
  })

  it("creates the app via useCreatePidApp and mutates with the entered name", () => {
    expect(src).toContain("useCreatePidApp(projectId)")
    expect(src).toContain("create.mutate(")
  })

  it("switches to the newly created app's tab on success", () => {
    expect(src).toContain("onCreated(app.id)")
  })
})
