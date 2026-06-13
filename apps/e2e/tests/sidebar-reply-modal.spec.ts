import { expect, test } from "@playwright/test"
import { rmSession, spawnSettled } from "./helpers"

// Clicking a session in the LEFT SIDEBAR opens the quick-reply modal. The modal
// must render in the native top layer (dialog.showModal()), not as a plain
// z-indexed <dialog open>: the home/drill-in views mount the xterm terminal
// canvas, which establishes its own stacking context and painted over a merely
// z-indexed overlay — so the modal opened invisibly *behind* the terminal and
// the session felt unclickable. Regression guard for "I can't click a session
// on the left side anymore".
test("sidebar session click opens the reply modal in the top layer", async ({ page }) => {
  await page.goto("/")
  const short = await spawnSettled(page)
  try {
    const row = page.locator(`[data-testid="sidebar-session"][data-short="${short}"]`)
    await expect(row).toBeVisible()
    await row.click()

    const modal = page.getByTestId("session-reply-modal")
    await expect(modal).toBeVisible()

    // Top-layer proof: only dialogs opened via showModal() match :modal. A
    // non-modal <dialog open> fails this — the exact bug we are fixing.
    expect(await modal.evaluate((d) => d.matches(":modal"))).toBe(true)

    // And it genuinely sits on top: the element at the viewport centre is
    // inside the dialog, not the terminal canvas underneath it.
    const onTop = await modal.evaluate((d) => {
      const el = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2)
      return !!el && d.contains(el)
    })
    expect(onTop).toBe(true)

    // The composer is reachable (Playwright actionability fails if covered).
    await modal.getByTestId("chat-textarea").click()
  } finally {
    rmSession(short)
  }
})
