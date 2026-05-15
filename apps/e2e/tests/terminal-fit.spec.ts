import { expect, test } from "@playwright/test"
import {
  cardLocator,
  dispatchDirect,
  rmSession,
  waitForCard,
  waitForSettled,
} from "./helpers"

// Regression: when the terminal tab mounts, the xterm fit pass used to latch
// onto stale flex dims and leave the terminal stuck at xterm's 80x24 default
// — only a manual window resize would expand it. We re-fit across upcoming
// frames so the rendered geometry matches the (large) host container.
test("terminal tab grows to fill its container on first mount", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.goto("/")
  const { short } = await dispatchDirect()
  try {
    await waitForCard(page, short, 20_000)
    await waitForSettled(page, short)

    await cardLocator(page, short).locator("a", { hasText: short }).first().click()
    await expect(page).toHaveURL(new RegExp(`/sessions/${short}$`))

    await page.getByTestId("tab-terminal").click()
    const host = page.getByTestId("terminal-host")
    await expect(host).toBeVisible()

    const screen = host.locator(".xterm-screen")
    await expect(screen).toBeVisible({ timeout: 15_000 })

    // The host container is roughly viewport-height minus header/tab chrome.
    // The xterm-screen height is set by FitAddon. If the initial fit grabbed
    // stale dims, it stays near 24 rows × ~17px ≈ 408px. With the fix the
    // screen should fill most of the host (allow generous slack for chrome).
    const heights = await page.evaluate(() => {
      const hostEl = document.querySelector('[data-testid="terminal-host"]') as HTMLElement | null
      const screenEl = hostEl?.querySelector(".xterm-screen") as HTMLElement | null
      return {
        hostHeight: hostEl?.clientHeight ?? 0,
        screenHeight: screenEl?.getBoundingClientRect().height ?? 0,
      }
    })

    expect(heights.hostHeight).toBeGreaterThan(600)
    // Screen should be at least 70% of host height — well above the stale 408px
    // a 1000px viewport would otherwise produce.
    expect(heights.screenHeight).toBeGreaterThan(heights.hostHeight * 0.7)
  } finally {
    rmSession(short)
  }
})
