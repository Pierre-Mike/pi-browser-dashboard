// Which collapsed left rail — if any — the project topbar should offer to
// reopen. A collapsed rail renders nothing beside the panel (see
// CollapsibleRail), so the only way back is this chip; it must appear for the
// rail belonging to the *active* tab and never for one the user can't see.

export type RailKind = "specs" | "brainstorm"

export type CollapsedRail = {
  readonly kind: RailKind
  // Base testid of the rail nav; the chip is `${testid}-expand`.
  readonly testid: string
  readonly ariaLabel: string
}

const RAILS: Record<RailKind, CollapsedRail> = {
  specs: { kind: "specs", testid: "pidapp-subtabs", ariaLabel: "Specs and apps" },
  brainstorm: { kind: "brainstorm", testid: "brainstorm-subtabs", ariaLabel: "Brainstorm boards" },
}

export type RailState = {
  readonly specsActive: boolean
  readonly brainstormActive: boolean
  readonly specsCollapsed: boolean
  readonly brainstormCollapsed: boolean
}

export const collapsedRail = (state: RailState): CollapsedRail | null => {
  if (state.specsActive && state.specsCollapsed) return RAILS.specs
  if (state.brainstormActive && state.brainstormCollapsed) return RAILS.brainstorm
  return null
}
