import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { SidebarRailProvider, SidebarReopenButton } from "./sidebarRail"

const render = (collapsed: boolean): string =>
  renderToStaticMarkup(
    <SidebarRailProvider rail={{ value: collapsed, toggle: () => {} }}>
      <div data-testid="top-row">
        <SidebarReopenButton />
        <span>page title</span>
      </div>
    </SidebarRailProvider>,
  )

describe("SidebarReopenButton", () => {
  test("expanded sidebar: nothing rendered — the in-rail collapse button owns the toggle", () => {
    const html = render(false)
    expect(html).not.toContain('data-testid="sidebar-rail-open"')
    expect(html).toContain("page title")
  })

  test("collapsed sidebar: a labelled chip inside the page's own top row", () => {
    const html = render(true)
    expect(html).toContain('data-testid="sidebar-rail-open"')
    expect(html).toContain('aria-label="Show sidebar"')
    // Inline in the row, so nothing below it loses width to a reserved column.
    expect(html).not.toContain("fixed")
  })
})
