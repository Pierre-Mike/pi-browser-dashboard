import { expect, test } from "@playwright/test"
import {
  cardLocator,
  dispatchDirect,
  ensureProject,
  rmSession,
  waitForCard,
  waitForSessionInRegistry,
  waitForSettled,
} from "./helpers"

test("activity tab shows the latest sessions across projects as a live feed", async ({ page }) => {
  const projectPath = ensureProject("proj-a", { gitInit: true })

  const a = await dispatchDirect(undefined, { cwd: projectPath })
  await waitForSessionInRegistry(a.short)
  const b = await dispatchDirect(undefined, { cwd: projectPath })
  await waitForSessionInRegistry(b.short)

  try {
    await page.goto("/")
    await waitForCard({ page, short: a.short, timeout: 20_000 })
    await waitForCard({ page, short: b.short, timeout: 20_000 })
    await waitForSettled({ page, short: a.short })
    await waitForSettled({ page, short: b.short })

    const feed = page.getByTestId("recent-sessions-feed")
    await expect(feed).toHaveCount(1)
    await expect(feed).toContainText(/most recent/i)

    // Both sessions surface in the cross-project feed regardless of project.
    await expect(feed.locator(cardLocator(page, a.short))).toHaveCount(1)
    await expect(feed.locator(cardLocator(page, b.short))).toHaveCount(1)
  } finally {
    rmSession(a.short)
    rmSession(b.short)
  }
})
