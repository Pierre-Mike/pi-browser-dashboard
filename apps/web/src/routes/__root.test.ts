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
    expect(src).toContain("<SidebarRailProvider rail={rail} drawer={drawer}>")
  })

  // The drawer's open flag is owned here for the same reason the rail flag is:
  // the toggle now renders inside <main> (in each page's chrome row) while the
  // drawer panel is a sibling of <main>, so no single component below can hold
  // both. Deliberately NOT persisted — a drawer that reopens itself on the next
  // page load is a drawer nobody asked for.
  it("owns the drawer's open flag, unpersisted, and hands the panel a close", () => {
    expect(src).toContain("useState(false)")
    expect(src).not.toContain('usePersistedFlag("pid:sidebar:drawer')
    expect(src).toContain("onClose={closeDrawer}")
  })

  it("measures the shell against the dynamic viewport, not the large one", () => {
    // min-h-screen on a phone is taller than the visible page, which shows as a
    // scrollable strip of empty gradient under every short page.
    expect(src).toContain("min-h-dvh")
    expect(src).not.toContain("min-h-screen")
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
