import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { CollapsibleRail, RailExpandButton } from "./CollapsibleRail"

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

  // A collapsed rail used to leave a slim vertical bar behind, so the panel
  // still started ~40px in from the left. It now renders nothing at all and the
  // reopen chip lives in the project topbar (see RailExpandButton), which is how
  // the panel gets the whole width.
  test("collapsed: renders nothing at all — no residual strip beside the panel", () => {
    expect(render(true)).toBe("")
  })
})

describe("RailExpandButton", () => {
  test("keeps the rail's expand testid + a11y label so it stays one control", () => {
    const html = renderToStaticMarkup(
      <RailExpandButton
        rail={{ kind: "specs", testid: "pidapp-subtabs", ariaLabel: "Specs and apps" }}
        onToggle={() => {}}
      />,
    )
    expect(html).toContain('data-testid="pidapp-subtabs-expand"')
    expect(html).toContain('aria-label="Show Specs and apps"')
  })
})
