import { expect, type Page, test } from "@playwright/test"

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
