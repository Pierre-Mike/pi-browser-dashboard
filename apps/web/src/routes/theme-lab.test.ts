import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const src = readFileSync(join(import.meta.dir, "theme-lab.tsx"), "utf8")
const tree = readFileSync(join(import.meta.dir, "..", "routeTree.gen.ts"), "utf8")

// Two things this route has to keep being, both of which a refactor could quietly
// take away: reachable, and derived from the catalog rather than from a list.
describe("the theme lab route", () => {
  it("is a real route in the generated tree, so the dead-code audit can see it", () => {
    // `fallow audit` walks the import graph from `main.tsx`, which imports
    // routeTree.gen.ts, which imports this file. A dev-only guard would leave the
    // component body unreachable instead — the shape the audit fails on.
    expect(tree).toContain("./routes/theme-lab")
    expect(tree).toContain("'/theme-lab'")
    expect(src).toContain('createFileRoute("/theme-lab")')
  })

  it("renders every catalogued family, both variants, without naming any of them", () => {
    // The whole point of a lab is that a tenth family shows up in it for free.
    expect(src).toContain("THEME_FAMILIES")
    expect(src).toContain("theme={family.light}")
    expect(src).toContain("theme={family.dark}")
    expect(src).not.toMatch(/"(pid|mono|terminal|sunset|candy|arcade|citrus|prism|neon)"/)
  })

  it("puts the two variants side by side rather than one after the other", () => {
    // A dark variant is where a saturated hue is least compromised; reviewing the
    // pair in sequence is how that asymmetry goes unnoticed.
    expect(src).toContain("lg:grid-cols-2")
  })

  it("says on the page why the two chip columns have to be read together", () => {
    expect(src).toContain("reporting")
    expect(src).toContain("idle")
  })
})
