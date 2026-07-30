import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { NavChromeChips, SidebarRailProvider } from "./sidebarRail"

const render = (collapsed: boolean): string =>
  renderToStaticMarkup(
    <SidebarRailProvider
      rail={{ value: collapsed, toggle: () => {} }}
      drawer={{ open: false, toggle: () => {} }}
    >
      <div data-testid="top-row">
        <NavChromeChips />
        <span>page title</span>
      </div>
    </SidebarRailProvider>,
  )

describe("NavChromeChips — the desktop reopen half", () => {
  test("expanded sidebar: no reopen chip — the in-rail collapse button owns the toggle", () => {
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

describe("NavChromeChips — the drawer-toggle half", () => {
  // Below lg there is no static sidebar at all, so this is the *only* way to
  // reach projects and sessions. It is unconditional for that reason: the
  // desktop chip may hide itself when the rail is open, this one may not.
  test("the drawer toggle renders whatever the desktop rail is doing", () => {
    for (const collapsed of [false, true]) {
      const html = render(collapsed)
      expect(html).toContain('data-testid="mobile-nav-toggle"')
      expect(html).toContain('aria-label="Open navigation"')
    }
  })

  test("reports the drawer's open state to assistive tech", () => {
    expect(
      renderToStaticMarkup(
        <SidebarRailProvider
          rail={{ value: false, toggle: () => {} }}
          drawer={{ open: true, toggle: () => {} }}
        >
          <NavChromeChips />
        </SidebarRailProvider>,
      ),
    ).toContain('aria-expanded="true"')
    expect(render(false)).toContain('aria-expanded="false"')
  })

  // Same rule as SES-C001: chrome that costs a whole row is chrome the content
  // pays for. Both chips are inline flow items in a row the page renders anyway.
  test("neither chip is positioned out of flow", () => {
    const html = render(true)
    expect(html).not.toContain("fixed")
    expect(html).not.toContain("absolute")
    expect(html).not.toContain("sticky")
  })
})
