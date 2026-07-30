import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { MobileNav } from "./MobileNav"

const render = (open = false): string =>
  renderToStaticMarkup(
    <MobileNav open={open} onClose={() => {}}>
      <a href="/x">child-link</a>
    </MobileNav>,
  )

describe("MobileNav", () => {
  test("renders the drawer shell and its backdrop", () => {
    const html = render()
    expect(html).toContain('data-testid="mobile-nav-drawer"')
    expect(html).toContain('data-testid="mobile-nav-backdrop"')
  })

  // The hamburger used to sit in a sticky <header> of this component's own — a
  // second chrome row that only phones paid for, ~53px of the scarcest axis on
  // the smallest screen, and it overlapped the top of every viewport-tall pane
  // below it. It now rides in the one chrome row each page already renders
  // (NavChromeChips), so this component contributes zero layout height.
  test("owns no chrome row of its own — the toggle lives in the page's row", () => {
    const html = render()
    expect(html).not.toContain("<header")
    expect(html).not.toContain('data-testid="mobile-nav-toggle"')
  })

  test("the drawer is parked off-canvas while closed", () => {
    const html = render(false)
    expect(html).toContain("-translate-x-full")
    expect(html).toContain("opacity-0")
  })

  test("the drawer slides in and its backdrop lights up when open", () => {
    const html = render(true)
    expect(html).toContain("translate-x-0")
    expect(html).toContain("opacity-100")
  })

  test("lazily mounts the drawer body — empty while closed", () => {
    // The body is a second Sidebar; mounting it before the drawer opens would
    // duplicate every sidebar testid/link in the DOM (Playwright strict-mode
    // violations) and open a redundant data subscription.
    expect(render(false)).not.toContain("child-link")
    expect(render(true)).toContain("child-link")
  })

  // The static rail takes over at lg, not md: at md an iPad in portrait spent
  // 288 of its 768px on a rail it could not spare.
  test("the drawer exists only below lg, where no static sidebar does", () => {
    const html = render()
    expect(html).toContain("lg:hidden")
    expect(html).not.toContain("md:hidden")
  })

  test("does not reintroduce the removed wordmark (e2e contract)", () => {
    // sidebar-home-link.spec.ts forbids the "pi-browser-dashboard" wordmark
    // anywhere on the page; the drawer must stay wordmark-free.
    expect(render(true)).not.toContain("pi-browser-dashboard")
  })
})
