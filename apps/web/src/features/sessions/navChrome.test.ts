import { describe, expect, test } from "bun:test"
import {
  drawerBackdropClass,
  drawerPanelClass,
  sidebarAsideClass,
  sidebarLoadingClass,
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
  test("desktop variant is hidden below md and sticks to the viewport", () => {
    const cls = sidebarAsideClass("desktop")
    expect(cls).toContain("hidden md:flex")
    expect(cls).toContain("sticky")
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
