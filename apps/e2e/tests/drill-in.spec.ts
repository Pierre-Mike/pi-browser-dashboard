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

    await expect(page.getByRole("link", { name: /Back to project grid/i })).toBeVisible()
    await expect(page.getByRole("button", { name: /Open in CLI/i })).toBeVisible()
    await expect(page.getByRole("heading", { level: 1 })).toContainText(short)

    // The drill-in opens on the terminal alone: it is the surface, not a tab, so
    // it is present before anything is clicked and no side pane is docked yet.
    await expect(page.getByTestId("session-terminal-pane")).toBeVisible()
    await expect(page.getByTestId("terminal-tab")).toBeAttached({ timeout: 30_000 })
    await expect(page.getByTestId("session-side-pane")).toHaveCount(0)
  } finally {
    rmSession(short)
  }
})
