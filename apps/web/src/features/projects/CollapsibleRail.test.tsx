import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { CollapsibleRail } from "./CollapsibleRail"

const render = (collapsed: boolean): string =>
  renderToStaticMarkup(
    <CollapsibleRail
      collapsed={collapsed}
      onToggle={() => {}}
      ariaLabel="Specs and apps"
      testid="pidapp-subtabs"
    >
      <button type="button" data-testid="child-tab">
        a spec
      </button>
    </CollapsibleRail>,
  )

describe("CollapsibleRail", () => {
  test("expanded: renders the rail nav, its children, and a collapse control", () => {
    const html = render(false)
    expect(html).toContain('data-testid="pidapp-subtabs"')
    expect(html).toContain('role="tablist"')
    expect(html).toContain('aria-label="Specs and apps"')
    // Children (the sub-tab buttons) are shown.
    expect(html).toContain('data-testid="child-tab"')
    // A control to hide the rail.
    expect(html).toContain('data-testid="pidapp-subtabs-collapse"')
    expect(html).not.toContain('data-testid="pidapp-subtabs-expand"')
  })

  test("collapsed: hides the rail + children, leaving only a slim expand control", () => {
    const html = render(true)
    // The wide rail and its children are gone, handing the width to the panel.
    expect(html).not.toContain('data-testid="pidapp-subtabs"')
    expect(html).not.toContain('data-testid="child-tab"')
    // Only the affordance to bring the rail back remains, labelled for a11y.
    expect(html).toContain('data-testid="pidapp-subtabs-expand"')
    expect(html).toContain('aria-label="Show Specs and apps"')
  })
})
