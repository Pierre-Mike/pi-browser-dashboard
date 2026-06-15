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

  test("lazily mounts the drawer body — empty while closed", () => {
    // The body is a second Sidebar; mounting it before the drawer opens would
    // duplicate every sidebar testid/link in the DOM (Playwright strict-mode
    // violations) and open a redundant data subscription.
    expect(render()).not.toContain("child-link")
    // The drawer shell itself is always present so it can slide in.
    expect(render()).toContain('data-testid="mobile-nav-drawer"')
  })

  test("does not reintroduce the removed wordmark (e2e contract)", () => {
    // sidebar-home-link.spec.ts forbids the "pi-browser-dashboard" wordmark
    // anywhere on the page; the mobile bar must stay wordmark-free.
    expect(render()).not.toContain("pi-browser-dashboard")
  })
})
