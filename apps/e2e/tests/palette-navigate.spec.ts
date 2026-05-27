import { expect, test } from "@playwright/test"
import { ensureProject, ensureProjectsTab } from "./helpers"

test("double-shift palette → select project → navigate to /projects/$id", async ({ page }) => {
  ensureProject("palette-nav-target", { gitInit: true })

  await page.goto("/")
  await ensureProjectsTab(page)
  await expect(
    page.locator('[data-testid="project-section"][data-project-id="palette-nav-target"]'),
  ).toBeVisible({ timeout: 15_000 })

  await page.keyboard.press("Shift")
  await page.keyboard.press("Shift")

  const modal = page.locator('[data-testid="palette-modal"]')
  await expect(modal).toBeVisible()

  // Anchor input interactions to the palette's search box rather than using
  // `page.keyboard.*` directly — page-level typing relies on whatever element
  // happened to be focused, and StrictMode's double-mount + the modal's
  // setTimeout(0) focus-on-open occasionally lose the race, so the Enter
  // keystroke lands on `document.body` instead of the input.
  const search = modal.locator('input[type="search"]')
  await search.fill("palette-nav-target")
  await expect(modal.locator('[data-testid="palette-row"]')).toHaveCount(1)
  await search.press("Enter")

  await expect(page).toHaveURL(/\/projects\/palette-nav-target$/)
  await expect(page.locator('[data-testid="project-dashboard"]')).toBeVisible()
  await expect(modal).toHaveCount(0)
})
