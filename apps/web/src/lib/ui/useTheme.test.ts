import { describe, expect, test } from "bun:test"
import { DEFAULT_THEME } from "./theme.core"
import { applyMachineTheme, publishThemeChoice, themeStoreSnapshot } from "./useTheme"

// The store is module-level state with two writers, so this reads as one
// narrative rather than as independent cases — the ordering *is* the behaviour
// under test. Under bun there is no `window`, so the localStorage seed is empty
// and the DOM writes no-op; what remains is exactly the precedence machinery.
describe("the theme store", () => {
  test("a browser with no pick and no machine default shows the fallback", () => {
    expect(themeStoreSnapshot().choice).toEqual(DEFAULT_THEME)
    expect(themeStoreSnapshot().machine).toEqual({})
  })

  test("the machine default arriving is adopted by a browser that never picked", () => {
    applyMachineTheme({ ui: { themeFamily: "terminal", themeMode: "dark" } })
    expect(themeStoreSnapshot().choice).toEqual({ family: "terminal", mode: "dark" })
    expect(themeStoreSnapshot().machine).toEqual({ family: "terminal", mode: "dark" })
  })

  test("an explicit pick overrides it", () => {
    publishThemeChoice({ family: "mono", mode: "light" })
    expect(themeStoreSnapshot().choice).toEqual({ family: "mono", mode: "light" })
  })

  // The distinction between an override and a cache, and the reason
  // applyMachineTheme never writes localStorage: a default changed from another
  // device must not silently repaint a browser whose user already chose.
  test("a machine default changed elsewhere does not overrule that pick", () => {
    applyMachineTheme({ ui: { themeFamily: "sunset", themeMode: "dark" } })
    expect(themeStoreSnapshot().choice).toEqual({ family: "mono", mode: "light" })
    expect(themeStoreSnapshot().machine).toEqual({ family: "sunset", mode: "dark" })
  })

  test("a failed settings load clears the machine offer without touching the pick", () => {
    applyMachineTheme({ ui: undefined })
    expect(themeStoreSnapshot().machine).toEqual({ family: undefined, mode: undefined })
    expect(themeStoreSnapshot().choice).toEqual({ family: "mono", mode: "light" })
  })

  test("the snapshot is a stable reference between changes, as useSyncExternalStore requires", () => {
    const before = themeStoreSnapshot()
    expect(themeStoreSnapshot()).toBe(before)
    applyMachineTheme({ ui: { themeFamily: "pid", themeMode: "light" } })
    expect(themeStoreSnapshot()).not.toBe(before)
  })

  test("re-applying the same machine default is a no-op, so it cannot loop", () => {
    const before = themeStoreSnapshot()
    applyMachineTheme({ ui: { themeFamily: "pid", themeMode: "light" } })
    expect(themeStoreSnapshot()).toBe(before)
    // …and so is one whose halves are unrecognised the same way the current one is.
    applyMachineTheme({ ui: { themeFamily: "pid", themeMode: "light" } })
    expect(themeStoreSnapshot()).toBe(before)
  })
})
