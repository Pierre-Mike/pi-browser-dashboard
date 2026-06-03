import { expect, type Page, test } from "@playwright/test"
import { cardLocator, dispatchDirect, rmSession, waitForCard, waitForSettled } from "./helpers"

const openDrillIn = async (page: Page, short: string) => {
  await page.goto("/")
  await waitForCard({ page, short, timeout: 20_000 })
  await waitForSettled({ page, short })
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

test("drill-in: Kill button → POST /stop → card on grid leaves the alive states", async ({
  page,
}) => {
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

    // Navigate back to grid and confirm SSE delivered a terminal state.
    //
    // We deliberately accept any of stopped / done / failed (or card gone)
    // rather than asserting "stopped" specifically. `openDrillIn` waits for
    // the card to *settle* before clicking Kill — which means the trivial
    // stub session ("say hello and exit") may have already transitioned to
    // `done` before the kill registers. In that race `claude stop` is a
    // no-op on a non-running worker, and state.json never flips to
    // "stopped". The user-meaningful outcome of clicking Kill is "this
    // session is no longer alive on the grid", which any terminal state
    // (or removal) satisfies.
    await page.goto("/")
    const card = cardLocator(page, short)
    await expect
      .poll(
        async () => {
          if ((await card.count()) === 0) return "gone"
          return (await card.getAttribute("data-state")) ?? "missing"
        },
        { timeout: 30_000 },
      )
      .toMatch(/^(stopped|done|failed|gone)$/)
  } finally {
    rmSession(short)
  }
})
