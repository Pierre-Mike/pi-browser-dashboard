import { expect, type Locator, type Page, test } from "@playwright/test"

// The theme is a runtime choice, not an OS reading: <html data-theme> carries
// the resolved daisyUI theme name, and the xterm palette follows *that*. The
// companion spec (terminal-light-mode) covers the default `system` mode, which
// still tracks prefers-color-scheme.
//
// The storage key is written literally here on purpose: apps/e2e drives the app
// from outside and must not import apps/web internals. It mirrors the private
// constant in apps/web/src/lib/ui/useTheme.ts.
const THEME_KEY = "pid:ui:theme"

// addInitScript runs before any app module, so the theme store's boot-time paint
// already sees the choice — no flash of the default theme on load.
const openWithTheme = async ({ page, stored }: { page: Page; stored: string }): Promise<void> => {
  await page.addInitScript(
    (seed: { key: string; value: string }) => window.localStorage.setItem(seed.key, seed.value),
    { key: THEME_KEY, value: stored },
  )
  await page.goto("/")
  await expect(page.getByTestId("dashboard")).toBeVisible({ timeout: 15_000 })
}

// Each family owns its xterm pane as well as its chrome: the palette in
// apps/web/src/features/terminal/terminalTheme.ts is keyed by resolved theme
// name, so all nine families have a pane colour of their own. Written out
// literally because apps/e2e drives the app from outside and must not import
// apps/web internals — the same rule as THEME_KEY above.
//
// The regression these guard is a family's terminal falling back to `pid`'s
// slate/sky pair, which is how `sunsetdark` used to show a cool navy rectangle
// inside warm plum chrome. So every assertion below names the family it is
// exercising, and PID_* appears only where the pid family is actually active.
const PID_DARK = "rgb(11, 18, 32)" // piddark   #0b1220 (frozen)
const PID_LIGHT = "rgb(248, 250, 252)" // pidlight  #f8fafc (frozen)
const TERMINAL_DARK = "rgb(6, 26, 14)" // terminaldark  #061a0e — phosphor
const SUNSET_LIGHT = "rgb(254, 245, 238)" // sunsetlight   #fef5ee — warm cream
const SUNSET_DARK = "rgb(30, 18, 26)" // sunsetdark    #1e121a — warm plum

const expectTerminalBackground = async ({
  page,
  color,
}: {
  page: Page
  color: string
}): Promise<void> => {
  await page.getByTestId("dashboard-tab-terminal").click()
  const host = page.getByTestId("global-terminal").getByTestId("terminal-host")
  await expect(host).toBeVisible()
  await expect(host).toHaveCSS("background-color", color)
}

test("an explicit dark family wins over a light OS preference", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" })
  await openWithTheme({ page, stored: "terminal:dark" })

  await expect(page.locator("html")).toHaveAttribute("data-theme", "terminaldark")
  await expect(page.locator("html")).toHaveCSS("color-scheme", "dark")
  // The terminal family's own pane, not pid's: a phosphor-green shell around a
  // slate-blue terminal was the defect.
  await expectTerminalBackground({ page, color: TERMINAL_DARK })
})

test("an explicit light family wins over a dark OS preference", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" })
  await openWithTheme({ page, stored: "sunset:light" })

  await expect(page.locator("html")).toHaveAttribute("data-theme", "sunsetlight")
  await expect(page.locator("html")).toHaveCSS("color-scheme", "light")
  await expectTerminalBackground({ page, color: SUNSET_LIGHT })
})

test("switching family repaints the terminal pane in that family's colours", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" })
  await openWithTheme({ page, stored: "pid:dark" })
  await expectTerminalBackground({ page, color: PID_DARK })

  // Driven through the real Appearance picker, and asserted twice over: a pane
  // that silently kept pid's colour would pass a single-family spec, and a pane
  // that only re-themed on reload would pass a seeded one.
  for (const [family, resolved, colour] of [
    ["terminal", "terminaldark", TERMINAL_DARK],
    ["sunset", "sunsetdark", SUNSET_DARK],
  ] as const) {
    await page.getByTestId("dashboard-tab-settings").click()
    await expect(page.getByTestId("gs-appearance-family")).toBeVisible()
    await page.getByTestId("gs-appearance-family").selectOption(family)
    await expect(page.locator("html")).toHaveAttribute("data-theme", resolved)
    await expectTerminalBackground({ page, color: colour })
    expect(colour).not.toBe(PID_DARK)
  }
})

test("a garbage stored value falls back to the default family instead of wedging", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" })
  await openWithTheme({ page, stored: "vaporwave:sepia" })

  await expect(page.locator("html")).toHaveAttribute("data-theme", "pidlight")
  // The palette lookup is total for the same reason the family lookup is: an
  // unrecognised name still has to paint a pane, not leave xterm with an
  // undefined theme.
  await expectTerminalBackground({ page, color: PID_LIGHT })
})

// ── shape ───────────────────────────────────────────────────────────────────
//
// A family owns component *shape*, not only colour: each sets `--rounded-box` /
// `--rounded-btn` / `--rounded-badge`, and every component sizes its corners
// from those vars rather than from a hardcoded `rounded-lg`.
//
// Asserting the CSS variable would prove nothing — a var that no element reads
// is dead, and that was the actual failure mode worth guarding: if the
// `borderRadius` aliases go missing from tailwind.config.js, `rounded-box`
// becomes an unknown class name that emits no CSS at all, and every unit test
// still passes because the class is spelled correctly. So these assert the
// *computed* radius of two real rendered elements — the terminal pane
// (`rounded-box`) and its Restart button (`rounded-btn`).

const CORNERS = [
  "border-top-left-radius",
  "border-top-right-radius",
  "border-bottom-right-radius",
  "border-bottom-left-radius",
] as const

// Corner by corner rather than the `border-radius` shorthand: the shorthand
// collapses to one value only when all four agree, so a rule that reached just
// two corners could still read as a pass.
const expectRadius = async ({
  target,
  radius,
}: {
  target: Locator
  radius: string
}): Promise<void> => {
  for (const corner of CORNERS) await expect(target).toHaveCSS(corner, radius)
}

const terminalPane = ({ page }: { page: Page }) =>
  page.getByTestId("global-terminal").getByTestId("terminal-host")
const terminalButton = ({ page }: { page: Page }) =>
  page.getByTestId("global-terminal").getByTestId("terminal-restart")

const openTerminalTab = async ({ page }: { page: Page }): Promise<void> => {
  await page.getByTestId("dashboard-tab-terminal").click()
  await expect(terminalPane({ page })).toBeVisible()
}

test("the default family resolves to its own declared shape tokens", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" })
  await openWithTheme({ page, stored: "pid:dark" })
  await openTerminalTab({ page })

  // piddark's --rounded-box: 0.75rem and --rounded-btn: 0.5rem. What is frozen
  // is the *token table* — `pid`'s three values are unchanged from when shape
  // was uniform. Individual elements did move, deliberately: this pane was
  // `rounded-lg` (8px) and is now `rounded-box` (12px), because the mapping is
  // by role, not radius-preserving. Tailwind's scale and daisyUI's tokens do
  // not line up, and chasing byte-identical pixels would have meant inventing a
  // fourth token per family to preserve accidents of the old literals.
  await expectRadius({ target: terminalPane({ page }), radius: "12px" })
  await expectRadius({ target: terminalButton({ page }), radius: "8px" })
})

test("choosing the terminal family squares the components, live", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" })
  await openWithTheme({ page, stored: "pid:dark" })
  await openTerminalTab({ page })
  await expectRadius({ target: terminalPane({ page }), radius: "12px" })

  // Driven through the real Appearance picker rather than by re-seeding
  // localStorage: the point is that a *user* changing family changes component
  // form, with no reload and no component edit.
  await page.getByTestId("dashboard-tab-settings").click()
  await expect(page.getByTestId("gs-appearance-family")).toBeVisible()
  await page.getByTestId("gs-appearance-family").selectOption("terminal")
  await expect(page.locator("html")).toHaveAttribute("data-theme", "terminaldark")

  await openTerminalTab({ page })
  await expectRadius({ target: terminalPane({ page }), radius: "0px" })
  await expectRadius({ target: terminalButton({ page }), radius: "0px" })
})

test("the sunset family softens the very same components", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" })
  await openWithTheme({ page, stored: "sunset:dark" })
  await openTerminalTab({ page })

  // sunsetdark's --rounded-box: 1rem and --rounded-btn: 0.75rem.
  await expectRadius({ target: terminalPane({ page }), radius: "16px" })
  await expectRadius({ target: terminalButton({ page }), radius: "12px" })
})
