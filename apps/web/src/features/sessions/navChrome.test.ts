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

describe("mainClass", () => {
  test("expanded: uniform padding on every side", () => {
    const cls = mainClass(false)
    expect(cls).toContain("px-4")
    expect(cls).not.toContain("pl-11")
  })
  test("collapsed: left padding widens on desktop to clear the floating reopen button", () => {
    const cls = mainClass(true)
    expect(cls).toContain("md:pl-11")
    expect(cls).not.toContain("px-4")
    // Phones never show the floating button (it's md:-only), so their left
    // padding stays the normal size instead of reserving clearance for it.
    expect(cls).toContain("pl-4")
  })
})

describe("sidebarRailOpenBtnClass", () => {
  test("desktop-only, fixed near the top-left corner, above page content", () => {
    expect(sidebarRailOpenBtnClass).toContain("hidden md:inline-flex")
    expect(sidebarRailOpenBtnClass).toContain("fixed")
    expect(sidebarRailOpenBtnClass).toContain("left-2")
    expect(sidebarRailOpenBtnClass).toContain("top-2")
  })
})
