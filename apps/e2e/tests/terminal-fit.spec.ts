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

  // Capture the /terminal/:short WebSocket URL so we can verify the cols/rows
  // handshake. The daemon allocates a pty via python3 forkpty and resizes it
  // in-band with stty before launching zellij. Without these params, zellij
  // renders at the daemon's 120x32 default in the top-left of the canvas.
  const termWs = page.waitForEvent("websocket", {
    predicate: (ws) => ws.url().includes(`/terminal/${short}`),
    timeout: 20_000,
  })

  try {
    await waitForCard(page, short, 20_000)
    await waitForSettled(page, short)

    await cardLocator(page, short).locator("a", { hasText: short }).first().click()
    await expect(page).toHaveURL(new RegExp(`/sessions/${short}$`))

    await page.getByTestId("tab-terminal").click()
    const host = page.getByTestId("terminal-host")
    await expect(host).toBeVisible()

    const wsUrl = new URL((await termWs).url())
    const cols = Number(wsUrl.searchParams.get("cols"))
    const rows = Number(wsUrl.searchParams.get("rows"))
    // At 1600x1000 the fit should produce well more than xterm's 80x24 default.
    expect(cols).toBeGreaterThan(120)
    expect(rows).toBeGreaterThan(30)

    const screen = host.locator(".xterm-screen")
    await expect(screen).toBeVisible({ timeout: 15_000 })

    // The host container is roughly viewport-height minus header/tab chrome.
    // The xterm-screen height is set by FitAddon. If the initial fit grabbed
    // stale dims, it stays near 24 rows × ~17px ≈ 408px. With the fix the
    // screen should fill most of the host (allow generous slack for chrome).
    const heights = await page.evaluate(() => {
      const hostEl = document.querySelector('[data-testid="terminal-host"]') as HTMLElement | null
      const screenEl = hostEl?.querySelector(".xterm-screen") as HTMLElement | null
      const tabEl = document.querySelector('[data-testid="terminal-tab"]') as HTMLElement | null
      return {
        hostHeight: hostEl?.clientHeight ?? 0,
        screenHeight: screenEl?.getBoundingClientRect().height ?? 0,
        tabBottom: tabEl?.getBoundingClientRect().bottom ?? 0,
        viewportHeight: window.innerHeight,
      }
    })

    expect(heights.hostHeight).toBeGreaterThan(600)
    // Screen should be at least 70% of host height — well above the stale 408px
    // a 1000px viewport would otherwise produce.
    expect(heights.screenHeight).toBeGreaterThan(heights.hostHeight * 0.7)
    // The terminal tab should reach the viewport bottom — the page container
    // used to subtract an extra 2rem that wasn't actually consumed by chrome,
    // leaving a ~32px gap below the status row.
    // ≤ 8px is the realistic bound: macOS and Linux subpixel rounding put
    // the bottom exactly at viewportHeight - 8 on some renderer paths, so a
    // strict `<` flakes between platforms. The regression we care about is
    // the ~32px gap from the old 2rem subtraction — anything ≤ 8 means the
    // tab fills the viewport.
    expect(heights.viewportHeight - heights.tabBottom).toBeLessThanOrEqual(8)
  } finally {
    rmSession(short)
  }
})
