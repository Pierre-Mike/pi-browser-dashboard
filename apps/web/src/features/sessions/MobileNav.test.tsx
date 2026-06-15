import { describe, expect, test } from "bun:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { MobileNav } from "./MobileNav"

const render = (): string =>
  renderToStaticMarkup(
    createElement(MobileNav, null, createElement("a", { href: "/x" }, "child-link")),
  )

describe("MobileNav", () => {
  test("renders a mobile-only hamburger toggle with an accessible label", () => {
    const html = render()
    expect(html).toContain('data-testid="mobile-nav-toggle"')
    expect(html).toContain('aria-label="Open navigation"')
    // Chrome is confined to phones; desktop keeps the static sidebar.
    expect(html).toContain("md:hidden")
  })

  test("the drawer is closed by default", () => {
    const html = render()
    expect(html).toContain('aria-expanded="false"')
    // Panel parked off-canvas, backdrop transparent.
    expect(html).toContain("-translate-x-full")
    expect(html).toContain("opacity-0")
  })

  test("renders the supplied navigation as the drawer body", () => {
    expect(render()).toContain("child-link")
  })
})
