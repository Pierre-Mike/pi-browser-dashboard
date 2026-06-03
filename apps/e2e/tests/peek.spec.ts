import { expect, test } from "@playwright/test"
import { cardLocator, dispatchDirect, rmSession, waitForCard, waitForSettled } from "./helpers"

// In sandbox mode there's no real Claude auth, so `claude peek` returns
// "login required". The card's catch-block renders "peek failed" in the
// summary div. This test asserts wiring: button → POST → response → UI
// updates `peek-summary` — independent of whether peek itself succeeded.
test("Peek button → POST /peek → peek-summary renders (success or error UX)", async ({ page }) => {
  await page.goto("/")
  const { short } = await dispatchDirect()
  try {
    await waitForCard({ page, short, timeout: 20_000 })
    await waitForSettled({ page, short })

    const card = cardLocator(page, short)
    const peekResp = page.waitForResponse(
      (r) => r.url().includes(`/sessions/${short}/peek`) && r.request().method() === "POST",
      { timeout: 30_000 },
    )
    await card.getByTestId("peek").click()
    const resp = await peekResp
    expect([200, 500]).toContain(resp.status())
    const body = (await resp.json()) as { short?: string; summary?: string; error?: string }
    expect(body.short ?? short).toBe(short)

    const summary = card.getByTestId("peek-summary")
    await expect(summary).toBeVisible({ timeout: 15_000 })
    await expect(summary).not.toBeEmpty()
  } finally {
    rmSession(short)
  }
})
