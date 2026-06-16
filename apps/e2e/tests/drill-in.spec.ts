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

    // The sandbox has no Claude auth, so this session never writes JSONL and the
    // transcript endpoint 404s. A not-ready transcript must render the empty chat
    // surface (attached, even with zero height) — NEVER a "Failed to load
    // transcript" error. That 404 is benign and the chat polls until the JSONL
    // appears.
    await expect(page.getByTestId("chat-transcript")).toBeAttached({ timeout: 30_000 })
    await expect(page.getByText(/Failed to load transcript/i)).toHaveCount(0)
  } finally {
    rmSession(short)
  }
})
