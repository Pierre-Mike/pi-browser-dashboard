import { expect, test } from "@playwright/test"
import { ensureProject } from "./helpers"

test("double-shift palette → select project → navigate to /projects/$id", async ({ page }) => {
  ensureProject("palette-nav-target", { gitInit: true })

  await page.goto("/")
  await expect(
    page.locator('[data-testid="project-section"][data-project-id="palette-nav-target"]'),
  ).toBeVisible({ timeout: 15_000 })

  await page.keyboard.press("Shift")
  await page.keyboard.press("Shift")

  const modal = page.locator('[data-testid="palette-modal"]')
  await expect(modal).toBeVisible()

  await page.keyboard.type("palette-nav-target")
  await expect(modal.locator('[data-testid="palette-row"]')).toHaveCount(1)
  await page.keyboard.press("Enter")

  await expect(page).toHaveURL(/\/projects\/palette-nav-target$/)
  await expect(page.locator('[data-testid="project-dashboard"]')).toBeVisible()
  await expect(modal).toHaveCount(0)
})
