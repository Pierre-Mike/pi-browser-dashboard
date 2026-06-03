import { expect, test } from "@playwright/test"
import { cardLocator, dispatchDirect, waitForCard, waitForCardGone } from "./helpers"

test("spawn → Delete (two-click confirm) → card gone", async ({ page }) => {
  await page.goto("/")
  const { short } = await dispatchDirect()
  await waitForCard({ page, short, timeout: 20_000 })

  const deleteBtn = cardLocator(page, short).getByTestId("delete")
  await deleteBtn.click()
  // First click switches the button into the confirm-armed state.
  await expect(deleteBtn).toHaveText(/Confirm/i)
  await deleteBtn.click()

  await waitForCardGone({ page, short, timeout: 30_000 })
})
