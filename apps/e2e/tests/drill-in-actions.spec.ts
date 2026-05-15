import { expect, test } from "@playwright/test"
import { cardLocator, dispatchDirect, rmSession, waitForCard, waitForSettled } from "./helpers"

const openDrillIn = async (page: Parameters<typeof waitForCard>[0], short: string) => {
  await page.goto("/")
  await waitForCard(page, short, 20_000)
  await waitForSettled(page, short)
  await cardLocator(page, short).locator("a", { hasText: short }).first().click()
  await expect(page).toHaveURL(new RegExp(`/sessions/${short}$`))
  // Wait for header to stabilize before clicking action buttons.
  await expect(page.getByRole("heading", { level: 1 })).toContainText(short)
}

test("drill-in: Peek button → POST /peek → peek-summary renders", async ({ page }) => {
  const { short } = await dispatchDirect()
  try {
    await openDrillIn(page, short)

    const peekResp = page.waitForResponse(
      (r) => r.url().includes(`/sessions/${short}/peek`) && r.request().method() === "POST",
      { timeout: 30_000 },
    )
    await page.getByTestId("peek").click()
    const resp = await peekResp
    expect([200, 500]).toContain(resp.status())

    const summary = page.getByTestId("peek-summary")
    await expect(summary).toBeVisible({ timeout: 15_000 })
    await expect(summary).not.toBeEmpty()
  } finally {
    rmSession(short)
  }
})

test("drill-in: Kill button → POST /stop → card on grid goes Stopped", async ({ page }) => {
  const { short } = await dispatchDirect()
  try {
    await openDrillIn(page, short)

    const stopResp = page.waitForResponse(
      (r) => r.url().includes(`/sessions/${short}/stop`) && r.request().method() === "POST",
      { timeout: 30_000 },
    )
    await page.getByTestId("stop").click()
    const resp = await stopResp
    expect(resp.status()).toBeLessThan(500)

    // Navigate back to grid and confirm SSE delivered the stopped state.
    await page.goto("/")
    await expect(cardLocator(page, short)).toHaveAttribute("data-state", "stopped", {
      timeout: 30_000,
    })
  } finally {
    rmSession(short)
  }
})
