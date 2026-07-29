import { expect, test } from "@playwright/test"

// No stored choice means the default family (`pid`) in `system` mode, so the
// resolved theme — and with it the xterm palette — follows the OS preference and
// must flip live when that preference changes, without tearing down the WS/pty.
//
// The two literals below are `pid`'s own pane colours (piddark #0b1220 /
// pidlight #f8fafc), which are byte-frozen in
// apps/web/src/features/terminal/terminalTheme.ts. Every other family has its
// own pair — theme-switch.spec.ts covers those. Asserting `data-theme` here is
// what keeps this spec honest about which family it is exercising: without it, a
// palette that fell back to pid's would still pass.
test("terminal background follows the OS color scheme", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" })
  await page.goto("/")
  await expect(page.getByTestId("dashboard")).toBeVisible({ timeout: 15_000 })
  await page.getByTestId("dashboard-tab-terminal").click()

  const host = page.getByTestId("global-terminal").getByTestId("terminal-host")
  await expect(host).toBeVisible()
  await expect(page.locator("html")).toHaveAttribute("data-theme", "pidlight")
  // slate-50 — pidlight's pane
  await expect(host).toHaveCSS("background-color", "rgb(248, 250, 252)")

  // Flipping the OS preference re-themes the live terminal in place.
  await page.emulateMedia({ colorScheme: "dark" })
  await expect(page.locator("html")).toHaveAttribute("data-theme", "piddark")
  await expect(host).toHaveCSS("background-color", "rgb(11, 18, 32)")

  await page.emulateMedia({ colorScheme: "light" })
  await expect(page.locator("html")).toHaveAttribute("data-theme", "pidlight")
  await expect(host).toHaveCSS("background-color", "rgb(248, 250, 252)")
})
