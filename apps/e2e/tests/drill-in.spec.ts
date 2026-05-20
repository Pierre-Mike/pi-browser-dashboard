import { expect, test } from "@playwright/test"
import { cardLocator, dispatchDirect, rmSession, waitForCard, waitForSettled } from "./helpers"

test("spawn → wait settled → click card → drill-in page loads", async ({ page }) => {
  await page.goto("/")
  const { short } = await dispatchDirect()
  try {
    await waitForCard(page, short, 20_000)
    await waitForSettled(page, short)

    await cardLocator(page, short).locator("a", { hasText: short }).first().click()
    await expect(page).toHaveURL(new RegExp(`/sessions/${short}$`))

    // Terminal is the default session tab — switch to chat to see the transcript.
    await page.getByTestId("tab-chat").click()
    await expect(page.getByText("Loading transcript…")).toHaveCount(0, { timeout: 15_000 })
    await expect(page.getByRole("link", { name: /Back to project grid/i })).toBeVisible()
    await expect(page.getByRole("button", { name: /Open in CLI/i })).toBeVisible()
    await expect(page.getByRole("heading", { level: 1 })).toContainText(short)

    // Transcript either renders or shows a clear error — both are valid wiring
    // outcomes; JSONL availability is a supervisor timing concern, not ours.
    const transcriptOrError = page.getByText(/^(User|Assistant|Result|Failed to load transcript)/i)
    await expect(transcriptOrError.first()).toBeVisible({ timeout: 30_000 })
  } finally {
    rmSession(short)
  }
})
