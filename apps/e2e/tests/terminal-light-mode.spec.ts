import { expect, test } from "@playwright/test"

// Tailwind runs in darkMode:"media"; the xterm terminal must follow the same
// OS preference instead of staying hardcoded dark — and flip live when the
// preference changes, without tearing down the WS/pty.
test("terminal background follows the OS color scheme", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" })
  await page.goto("/")
  await expect(page.getByTestId("dashboard")).toBeVisible({ timeout: 15_000 })
  await page.getByTestId("dashboard-tab-terminal").click()

  const host = page.getByTestId("global-terminal").getByTestId("terminal-host")
  await expect(host).toBeVisible()
  // slate-50 — light xterm palette
  await expect(host).toHaveCSS("background-color", "rgb(248, 250, 252)")

  // Flipping the OS preference re-themes the live terminal in place.
  await page.emulateMedia({ colorScheme: "dark" })
  await expect(host).toHaveCSS("background-color", "rgb(11, 18, 32)")

  await page.emulateMedia({ colorScheme: "light" })
  await expect(host).toHaveCSS("background-color", "rgb(248, 250, 252)")
})
