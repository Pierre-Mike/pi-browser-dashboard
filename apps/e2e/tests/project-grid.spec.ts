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

test("two sessions on same cwd group under one ProjectSection", async ({ page }) => {
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

    const section = page.locator('[data-testid="project-section"][data-project-id="proj-a"]')
    await expect(section).toHaveCount(1)
    await expect(section).toHaveAttribute("data-session-count", "2")
    await expect(section).toContainText("2 sessions")

    await expect(section.locator(cardLocator(page, a.short))).toHaveCount(1)
    await expect(section.locator(cardLocator(page, b.short))).toHaveCount(1)
  } finally {
    rmSession(a.short)
    rmSession(b.short)
  }
})
