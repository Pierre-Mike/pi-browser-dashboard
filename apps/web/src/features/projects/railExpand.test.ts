import { describe, expect, test } from "bun:test"
import { collapsedRail } from "./railExpand"

const args = {
  specsActive: false,
  brainstormActive: false,
  specsCollapsed: false,
  brainstormCollapsed: false,
}

describe("collapsedRail", () => {
  test("offers nothing while the active tab's rail is showing", () => {
    expect(collapsedRail({ ...args, specsActive: true })).toBeNull()
    expect(collapsedRail({ ...args, brainstormActive: true })).toBeNull()
  })

  test("offers the Specs rail while the Specs tab is active and its rail is collapsed", () => {
    const rail = collapsedRail({ ...args, specsActive: true, specsCollapsed: true })
    expect(rail?.testid).toBe("pidapp-subtabs")
    expect(rail?.ariaLabel).toBe("Specs and apps")
  })

  test("offers the Brainstorm rail on the Brainstorm tab", () => {
    const rail = collapsedRail({ ...args, brainstormActive: true, brainstormCollapsed: true })
    expect(rail?.testid).toBe("brainstorm-subtabs")
    expect(rail?.ariaLabel).toBe("Brainstorm boards")
  })

  test("ignores a rail collapsed on a tab that isn't showing", () => {
    // Terminal is active: neither rail exists on screen, so the topbar must not
    // sprout a chip for one.
    expect(collapsedRail({ ...args, specsCollapsed: true, brainstormCollapsed: true })).toBeNull()
  })

  test("offers only the active tab's rail when both are collapsed", () => {
    const rail = collapsedRail({
      specsActive: false,
      brainstormActive: true,
      specsCollapsed: true,
      brainstormCollapsed: true,
    })
    expect(rail?.kind).toBe("brainstorm")
  })
})
