import { test } from "@playwright/test"
import { cardLocator, dispatchDirect, rmSession, waitForCard, waitForState } from "./helpers"

test("spawn → click Kill → state goes Stopped", async ({ page }) => {
  await page.goto("/")
  const { short } = await dispatchDirect()
  try {
    await waitForCard(page, short, 20_000)
    // Hit Kill while the session is still alive (working or idle).
    await cardLocator(page, short).getByTestId("stop").click()
    await waitForState(page, short, "stopped", 30_000)
  } finally {
    rmSession(short)
  }
})
