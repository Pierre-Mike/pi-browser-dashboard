import { describe, expect, test } from "bun:test"
import { BOARD_RAIL, collapsedRail } from "./railExpand"

const args = { specsActive: false, specsCollapsed: false }

describe("collapsedRail", () => {
  test("offers nothing while the active tab's rail is showing", () => {
    expect(collapsedRail({ ...args, specsActive: true })).toBeNull()
  })

  test("offers the Specs rail while the Specs tab is active and its rail is collapsed", () => {
    const rail = collapsedRail({ specsActive: true, specsCollapsed: true })
    expect(rail?.testid).toBe("pidapp-subtabs")
    expect(rail?.ariaLabel).toBe("Specs and apps")
  })

  test("ignores a rail collapsed on a tab that isn't showing", () => {
    // Terminal is active: the rail doesn't exist on screen, so the topbar must
    // not sprout a chip for it.
    expect(collapsedRail({ ...args, specsCollapsed: true })).toBeNull()
  })
})

describe("BOARD_RAIL", () => {
  test("keeps the ids the boards rail and its expand chip are driven by", () => {
    expect(BOARD_RAIL.testid).toBe("brainstorm-subtabs")
    expect(BOARD_RAIL.ariaLabel).toBe("Brainstorm boards")
  })
})
