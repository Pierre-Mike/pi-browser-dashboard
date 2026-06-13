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
})
