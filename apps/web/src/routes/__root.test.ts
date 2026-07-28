import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const src = readFileSync(join(import.meta.dir, "__root.tsx"), "utf8")

// A fully-collapsed sidebar must hand its entire width to the page: no floating
// button overlaying content, and therefore no left column reserved to clear one.
// The layout publishes the collapse flag instead, and each page's top row hosts
// the reopen chip (see features/sessions/sidebarRail.tsx).
describe("root layout — collapsed sidebar leaves no left gap", () => {
  it("publishes the rail flag through SidebarRailProvider", () => {
    expect(src).toContain('from "../features/sessions/sidebarRail"')
    expect(src).toContain("<SidebarRailProvider rail={rail}>")
  })

  it("renders no floating reopen button of its own", () => {
    expect(src).not.toContain('data-testid="sidebar-rail-open"')
    expect(src).not.toContain("sidebarRailOpenBtnClass")
  })

  it("gives <main> the same uniform padding whatever the rail does", () => {
    expect(src).toContain("className={mainClass}")
    expect(src).not.toMatch(/mainClass\(/)
  })
})
