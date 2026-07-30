import { describe, expect, test } from "bun:test"
import {
  drawerBackdropClass,
  drawerPanelClass,
  drawerToggleBtnClass,
  fillViewportClass,
  mainClass,
  sidebarAsideClass,
  sidebarLoadingClass,
  sidebarRailOpenBtnClass,
} from "./navChrome"

describe("drawerPanelClass", () => {
  test("slides in when open", () => {
    expect(drawerPanelClass(true)).toContain("translate-x-0")
    expect(drawerPanelClass(true)).not.toContain("-translate-x-full")
  })
  test("slides off-canvas when closed", () => {
    expect(drawerPanelClass(false)).toContain("-translate-x-full")
  })
})

describe("drawerBackdropClass", () => {
  test("is interactive and visible when open", () => {
    const open = drawerBackdropClass(true)
    expect(open).toContain("opacity-100")
    expect(open).toContain("pointer-events-auto")
  })
  test("is invisible and non-interactive when closed", () => {
    const closed = drawerBackdropClass(false)
    expect(closed).toContain("opacity-0")
    expect(closed).toContain("pointer-events-none")
  })
})

describe("sidebarAsideClass", () => {
  // Collapsing the desktop rail no longer shrinks this element to a slim
  // strip — <Sidebar> renders nothing at all instead (see Sidebar.tsx), so
  // there is only one desktop shape left to describe here.
  test("desktop variant is hidden below lg, sticky, and the full w-72 width", () => {
    const cls = sidebarAsideClass("desktop")
    expect(cls).toContain("hidden lg:flex")
    expect(cls).toContain("sticky")
    expect(cls).toContain("w-72")
  })
  // md (768px) is exactly an iPad in portrait, so the old breakpoint spent 288
  // of those 768 pixels on a permanent rail and left a ~450px content column
  // for a terminal. The rail belongs to widths that can spare it; a tablet gets
  // the drawer and one tap.
  test("the desktop rail starts at lg, never at md", () => {
    expect(sidebarAsideClass("desktop")).not.toContain("md:")
  })
  test("drawer variant is always visible and fills its container", () => {
    const cls = sidebarAsideClass("drawer")
    expect(cls).not.toContain("hidden")
    expect(cls).not.toContain("lg:flex")
    expect(cls).not.toContain("sticky")
    expect(cls).toContain("h-full")
  })
  // 100vh is the *large* viewport on a phone: it counts the strip behind a
  // retractable URL bar, so a vh-tall sticky rail parks its own footer out of
  // reach. dvh tracks whatever is actually visible right now.
  test("desktop rail measures the dynamic viewport, not the large one", () => {
    const cls = sidebarAsideClass("desktop")
    expect(cls).toContain("h-dvh")
    expect(cls).not.toContain("h-screen")
  })
})

describe("sidebarLoadingClass", () => {
  test("desktop loading placeholder is hidden below lg", () => {
    expect(sidebarLoadingClass("desktop")).toContain("hidden lg:block")
  })
  test("drawer loading placeholder is always visible", () => {
    expect(sidebarLoadingClass("drawer")).not.toContain("hidden")
  })
})

// Collapsing the rail used to widen <main>'s left padding to clear a floating
// reopen button, which left an empty column running the full page height. The
// button now lives inline in each page's top row (see NavChromeChips), so page
// content keeps the same uniform padding whatever the rail does — the left edge
// is fully used.
describe("mainClass", () => {
  test("no state-dependent left column", () => {
    expect(mainClass).not.toContain("pl-11")
  })
  // A phone has ~390px to spend and a 16px gutter per side is 8% of it. The
  // vertical padding stays py-4 at every width because fillViewportClass
  // cancels it with -my-4; making that half responsive would need a matching
  // responsive negative margin for no visible gain.
  test("gutters narrow on phones and widen from sm up", () => {
    expect(mainClass).toContain("px-2")
    expect(mainClass).toContain("sm:px-4")
    expect(mainClass).toContain("py-4")
    expect(mainClass).not.toContain("sm:py-")
  })
})

describe("fillViewportClass", () => {
  // All three primary surfaces size their fill-the-window tabs (terminal,
  // files, chat…) from this one string, so the dvh fix cannot land on two of
  // them and miss the third — which is how they drifted to two different
  // paddings in the first place.
  test("is a dynamic-viewport-tall box that cancels <main>'s vertical padding", () => {
    expect(fillViewportClass).toContain("h-dvh")
    expect(fillViewportClass).not.toContain("h-screen")
    expect(fillViewportClass).toContain("-my-4")
  })
})

describe("sidebarRailOpenBtnClass", () => {
  // Inline in the page's top row, not fixed over it: a fixed button forces the
  // page to reserve clearance, which is the gap we removed.
  test("desktop-only inline chip that costs no layout column", () => {
    expect(sidebarRailOpenBtnClass).toContain("hidden lg:inline-flex")
    expect(sidebarRailOpenBtnClass).toContain("shrink-0")
    expect(sidebarRailOpenBtnClass).not.toContain("fixed")
    expect(sidebarRailOpenBtnClass).not.toContain("absolute")
  })
})

describe("drawerToggleBtnClass", () => {
  // The mirror image of the chip above: it exists exactly where the desktop
  // rail does not, and it rides in the same already-rendered row rather than in
  // a sticky bar of its own. That bar cost every phone a row of height AND
  // pushed each viewport-tall pane the same distance below the fold.
  test("is the complement of the desktop chip — present only below lg", () => {
    expect(drawerToggleBtnClass).toContain("lg:hidden")
    expect(drawerToggleBtnClass).toContain("shrink-0")
    expect(drawerToggleBtnClass).not.toContain("fixed")
    expect(drawerToggleBtnClass).not.toContain("sticky")
  })
  // The only route to navigation on a phone, and it is hit with a thumb: 36px,
  // where the mouse-driven chip beside it is 24px.
  test("is finger-sized, and larger than the desktop chip", () => {
    expect(drawerToggleBtnClass).toContain("h-9 w-9")
    expect(sidebarRailOpenBtnClass).toContain("h-6 w-6")
  })
})
