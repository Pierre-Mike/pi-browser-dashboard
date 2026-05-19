import { expect, test } from "@playwright/test"
import { cardLocator, ensureProject, rmSession, waitForCard, waitForSettled } from "./helpers"

test("inline spawn on project dashboard: typing + submit creates a session", async ({ page }) => {
  ensureProject("proj-inline-spawn", { gitInit: true })

  await page.goto("/projects/proj-inline-spawn")

  const dash = page.locator('[data-testid="project-dashboard"]')
  await expect(dash).toBeVisible({ timeout: 15_000 })

  // Inline spawn form must live inside the Sessions tab panel — not a portaled modal.
  const sessionsPanel = page.locator('[data-testid="project-tab-panel-sessions"]')
  const form = sessionsPanel.locator('[data-testid="inline-spawn"]')
  await expect(form).toBeVisible()
  // No modal should appear — spawn must be inline.
  await expect(page.locator('[data-testid="spawn-modal"]')).toHaveCount(0)

  const dispatchResp = page.waitForResponse(
    (r) => r.url().endsWith("/dispatch") && r.request().method() === "POST" && r.ok(),
    { timeout: 15_000 },
  )

  await page.getByTestId("inline-spawn-input").fill("say hello and exit")
  await page.getByTestId("inline-spawn-submit").click()

  const resp = await dispatchResp
  const { short } = (await resp.json()) as { short: string }

  try {
    await waitForCard(page, short, 20_000)
    await waitForSettled(page, short)
    await expect(dash.locator(cardLocator(page, short))).toHaveCount(1)
    // Input should clear after successful spawn.
    await expect(page.getByTestId("inline-spawn-input")).toHaveValue("")
  } finally {
    rmSession(short)
  }
})
