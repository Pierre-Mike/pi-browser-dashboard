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

    // SES-C002: the project name moved from a small line ABOVE the card into a
    // gutter BESIDE it — a class-name test can't tell those apart, so measure.
    const row = page.getByTestId("recent-session-row").filter({ has: cardLocator(page, a.short) })
    const label = await row.getByTestId("recent-session-project").boundingBox()
    const card = await row.getByTestId("session-card").boundingBox()
    if (!label || !card) throw new Error("row is missing its project label or card")
    // Entirely left of the card, never overlapping it…
    expect(label.x + label.width).toBeLessThanOrEqual(card.x)
    // …and on the card's own line: the label's top sits inside the card's span.
    expect(label.y).toBeGreaterThanOrEqual(card.y)
    expect(label.y).toBeLessThan(card.y + card.height)
  } finally {
    rmSession(a.short)
    rmSession(b.short)
  }
})
