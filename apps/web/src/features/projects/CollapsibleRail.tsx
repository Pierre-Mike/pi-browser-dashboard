import type { ReactNode } from "react"
import { railCollapseBtnClass, railExpandBtnClass, subTabRailClass } from "../../lib/tabDock"

type Props = {
  readonly collapsed: boolean
  readonly onToggle: () => void
  readonly ariaLabel: string
  // Base testid of the rail nav; the toggle controls derive `${testid}-collapse`
  // / `${testid}-expand` from it.
  readonly testid: string
  readonly children: ReactNode
}

// A left sub-tab rail (see subTabRailClass) that can collapse to a slim vertical
// button, handing its width to the panel content. The Specs and Brainstorm tabs
// share it so both reduce identically. Default (expanded) keeps the original
// rail markup untouched, so existing e2e that asserts the rail is visible on
// load stays green.
export const CollapsibleRail = ({ collapsed, onToggle, ariaLabel, testid, children }: Props) => {
  if (collapsed) {
    return (
      <button
        type="button"
        data-testid={`${testid}-expand`}
        onClick={onToggle}
        title={`Show ${ariaLabel}`}
        aria-label={`Show ${ariaLabel}`}
        className={railExpandBtnClass}
      >
        <span aria-hidden>»</span>
      </button>
    )
  }
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
