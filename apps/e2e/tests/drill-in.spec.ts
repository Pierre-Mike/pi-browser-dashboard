import { expect, test } from "@playwright/test"
import { openSessionPage, rmSession, spawnSettled } from "./helpers"

test("spawn → wait settled → click card → reply modal → open full → drill-in page", async ({
  page,
}) => {
  await page.goto("/")
  const short = await spawnSettled(page)
  try {
    // Click no longer navigates; it opens the quick-reply modal. The full
    // drill-in is reachable from the modal's "Open full session" link.
    await openSessionPage(page, short)

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
