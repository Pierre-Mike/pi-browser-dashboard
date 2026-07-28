import { describe, expect, test } from "bun:test"
import {
  drawerBackdropClass,
  drawerPanelClass,
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
  test("desktop variant is hidden below md, sticky, and the full w-72 width", () => {
    const cls = sidebarAsideClass("desktop")
    expect(cls).toContain("hidden md:flex")
    expect(cls).toContain("sticky")
    expect(cls).toContain("w-72")
  })
  test("drawer variant is always visible and fills its container", () => {
    const cls = sidebarAsideClass("drawer")
    expect(cls).not.toContain("hidden")
    expect(cls).not.toContain("md:flex")
    expect(cls).not.toContain("sticky")
    expect(cls).toContain("h-full")
  })
})

describe("sidebarLoadingClass", () => {
  test("desktop loading placeholder is hidden below md", () => {
    expect(sidebarLoadingClass("desktop")).toContain("hidden md:block")
  })
  test("drawer loading placeholder is always visible", () => {
    expect(sidebarLoadingClass("drawer")).not.toContain("hidden")
  })
})

// Collapsing the rail used to widen <main>'s left padding to clear a floating
// reopen button, which left an empty column running the full page height. The
// button now lives inline in each page's top row (see SidebarReopenButton), so
// page content keeps the same uniform padding whatever the rail does — the left
// edge is fully used.
describe("mainClass", () => {
  test("uniform padding on every side, with no state-dependent left column", () => {
    expect(mainClass).toContain("px-4")
    expect(mainClass).not.toContain("pl-11")
  })
})

describe("sidebarRailOpenBtnClass", () => {
  // Inline in the page's top row, not fixed over it: a fixed button forces the
  // page to reserve clearance, which is the gap we removed.
  test("desktop-only inline chip that costs no layout column", () => {
    expect(sidebarRailOpenBtnClass).toContain("hidden md:inline-flex")
    expect(sidebarRailOpenBtnClass).toContain("shrink-0")
    expect(sidebarRailOpenBtnClass).not.toContain("fixed")
    expect(sidebarRailOpenBtnClass).not.toContain("absolute")
  })
})
