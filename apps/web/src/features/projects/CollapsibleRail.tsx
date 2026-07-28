import type { ReactNode } from "react"
import { railCollapseBtnClass, railExpandBtnClass, subTabRailClass } from "../../lib/tabDock"
import type { CollapsedRail } from "./railExpand"

type Props = {
  readonly collapsed: boolean
  readonly onToggle: () => void
  readonly ariaLabel: string
  // Base testid of the rail nav; the collapse control derives
  // `${testid}-collapse` from it.
  readonly testid: string
  readonly children: ReactNode
}

// A left sub-tab rail (see subTabRailClass) that vanishes when collapsed,
// handing every pixel of its width to the panel content. The Specs and
// Brainstorm tabs share it so both reduce identically. Collapsed it renders
// nothing — not even a slim strip, which used to keep the panel indented — and
// the topbar's RailExpandButton is what brings it back. Default (expanded) keeps
// the original rail markup untouched, so existing e2e that asserts the rail is
// visible on load stays green.
export const CollapsibleRail = ({ collapsed, onToggle, ariaLabel, testid, children }: Props) => {
  if (collapsed) return null
  return (
    <nav role="tablist" aria-label={ariaLabel} data-testid={testid} className={subTabRailClass}>
      <div className="flex justify-end">
        <button
          type="button"
          data-testid={`${testid}-collapse`}
          onClick={onToggle}
          title={`Hide ${ariaLabel}`}
          aria-label={`Hide ${ariaLabel}`}
          className={railCollapseBtnClass}
        >
          <span aria-hidden>«</span>
        </button>
      </div>
      {children}
    </nav>
  )
}

// The other half of the pair: the chip the project topbar renders while the
// active tab's rail is collapsed (see collapsedRail). It carries the same
// `${testid}-expand` id the rail used to render in place, so it stays one
// recognisable control — it just no longer eats a column of the panel.
export const RailExpandButton = ({
  rail,
  onToggle,
}: {
  readonly rail: CollapsedRail
  readonly onToggle: () => void
}) => (
  <button
    type="button"
    data-testid={`${rail.testid}-expand`}
    onClick={onToggle}
    title={`Show ${rail.ariaLabel}`}
    aria-label={`Show ${rail.ariaLabel}`}
    className={railExpandBtnClass}
  >
    <span aria-hidden>»</span>
  </button>
)
