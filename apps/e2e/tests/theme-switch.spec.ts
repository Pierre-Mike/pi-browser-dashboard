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

// terminalTheme.ts's two backgrounds. The terminal palette is still one
// light/dark pair shared by every family (per-family xterm colours are a later
// change) — what this spec pins is *which* of the pair a chosen theme selects.
const XTERM_DARK = "rgb(11, 18, 32)"
const XTERM_LIGHT = "rgb(248, 250, 252)"

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
  await expectTerminalBackground({ page, color: XTERM_DARK })
})

test("an explicit light family wins over a dark OS preference", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" })
  await openWithTheme({ page, stored: "sunset:light" })

  await expect(page.locator("html")).toHaveAttribute("data-theme", "sunsetlight")
  await expect(page.locator("html")).toHaveCSS("color-scheme", "light")
  await expectTerminalBackground({ page, color: XTERM_LIGHT })
})

test("a garbage stored value falls back to the default family instead of wedging", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" })
  await openWithTheme({ page, stored: "vaporwave:sepia" })

  await expect(page.locator("html")).toHaveAttribute("data-theme", "pidlight")
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

test("the default family's shape is unchanged by tokenizing radius", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" })
  await openWithTheme({ page, stored: "pid:dark" })
  await openTerminalTab({ page })

  // piddark's --rounded-box: 0.75rem and --rounded-btn: 0.5rem. `pid` is the
  // default and byte-frozen: it must look exactly as it did when these radii
  // were spelled `rounded-lg` in the component.
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
