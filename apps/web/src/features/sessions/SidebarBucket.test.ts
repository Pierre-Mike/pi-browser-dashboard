import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const src = readFileSync(join(import.meta.dir, "SidebarBucket.tsx"), "utf8")

describe("SidebarBucket project row", () => {
  it("does not render the git branch in the left project bar", () => {
    // The branch is shown on the project dashboard header, not in the sidebar
    // row, which stays compact — name + session count + actions only.
    expect(src).not.toContain("sidebar-project-branch")
    expect(src).not.toContain("project.branch")
  })

  it("does not double the row's own vertical padding with an outer wrapper", () => {
    // The header row already carries its own `py-1`; a `py-1.5` wrapper
    // around it just compounds the padding on every bucket.
    expect(src).not.toMatch(/<div className="px-1\.5 py-1\.5">/)
  })
})
