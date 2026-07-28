// Which collapsed left rail — if any — a topbar should offer to reopen. A
// collapsed rail renders nothing beside the panel (see CollapsibleRail), so the
// only way back is this chip; it must appear for the rail belonging to the
// *active* tab and never for one the user can't see.

export type RailKind = "specs" | "brainstorm"

export type CollapsedRail = {
  readonly kind: RailKind
  // Base testid of the rail nav; the chip is `${testid}-expand`.
  readonly testid: string
  readonly ariaLabel: string
}

const SPECS_RAIL: CollapsedRail = {
  kind: "specs",
  testid: "pidapp-subtabs",
  ariaLabel: "Specs and apps",
}

// The boards rail lives on the session drill-in, whose Brainstorm panel renders
// its own chip inline: it is the only rail on that page, so it needs the
// descriptor but not the active-tab resolution below.
export const BOARD_RAIL: CollapsedRail = {
  kind: "brainstorm",
  testid: "brainstorm-subtabs",
  ariaLabel: "Brainstorm boards",
}

export type RailState = {
  readonly specsActive: boolean
  readonly specsCollapsed: boolean
}

export const collapsedRail = (state: RailState): CollapsedRail | null =>
  state.specsActive && state.specsCollapsed ? SPECS_RAIL : null
