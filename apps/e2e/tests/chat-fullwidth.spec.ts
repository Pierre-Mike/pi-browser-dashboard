import { expect, test } from "@playwright/test"
import { cardLocator, dispatchDirect, rmSession, waitForCard, waitForSettled } from "./helpers"

// Regression guard: the chat pane (transcript + composer) must fill the
// available column, not be capped at the old max-w-3xl (768px) reading width.
// We assert the composer renders meaningfully wider than that cap; the exact
// pixel count depends on viewport + sidebar so we just require a clear margin.
const OLD_CAP_PX = 768
const MIN_WIDTH_PX = 900

test("chat tab fills available width (not capped at max-w-3xl)", async ({ page }) => {
  await page.goto("/")
  // Terminal is the default dashboard tab — switch to Projects to see cards.
  await page.getByTestId("dashboard-tab-projects").click()
  const { short } = await dispatchDirect()
  try {
    await waitForCard(page, short, 20_000)
    await waitForSettled(page, short)

    await cardLocator(page, short).locator("a", { hasText: short }).first().click()
    await expect(page).toHaveURL(new RegExp(`/sessions/${short}$`))
    await expect(page.getByText("Loading transcript…")).toHaveCount(0, { timeout: 15_000 })

    // Terminal is the default session tab — switch to chat for this assertion.
    await page.getByTestId("tab-chat").click()

    const composer = page.getByTestId("chat-composer")
    await expect(composer).toBeVisible()

    const box = await composer.boundingBox()
    if (!box) throw new Error("composer should have a bounding box")
    expect(box.width).toBeGreaterThan(MIN_WIDTH_PX)
    expect(box.width).toBeGreaterThan(OLD_CAP_PX + 100)
  } finally {
    rmSession(short)
  }
})
