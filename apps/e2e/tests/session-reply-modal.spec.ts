import { expect, test } from "@playwright/test"
import { openReplyModal, rmSession, spawnSettled } from "./helpers"

// Clicking a session card opens a quick-reply modal — it shows the session's
// last message and a composer to answer it — instead of navigating to the
// full session page. The full page stays reachable via the modal's link.
test("clicking a session card opens the reply modal (no navigation)", async ({ page }) => {
  await page.goto("/")
  const short = await spawnSettled(page)
  try {
    const modal = await openReplyModal(page, short)

    // Did not navigate to the drill-in route.
    await expect(page).not.toHaveURL(new RegExp(`/sessions/${short}$`))

    // Last-message panel and a composer to answer are present.
    await expect(modal.getByTestId("reply-last-message")).toBeVisible()
    await expect(modal.getByTestId("chat-textarea")).toBeVisible()
    await expect(modal.getByTestId("reply-open-full")).toBeVisible()

    // Escape closes the modal and we are still on the dashboard.
    await page.keyboard.press("Escape")
    await expect(page.getByTestId("session-reply-modal")).toHaveCount(0)
    await expect(page).toHaveURL(/\/$/)
  } finally {
    rmSession(short)
  }
})
