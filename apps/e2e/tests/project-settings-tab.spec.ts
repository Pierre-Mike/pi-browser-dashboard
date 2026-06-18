import { expect, test } from "@playwright/test"
import { ensureProject } from "./helpers"

// The project dashboard exposes a Settings tab that manages the project's
// <project>/.pid/settings.json. To start it edits the default selected skills
// pre-checked in the spawn modal; saving persists to disk and survives reload.
test.describe("project settings tab", () => {
  test("opens the settings panel listing the default-skills control", async ({ page }) => {
    ensureProject("proj-settings", { gitInit: true })

    await page.goto("/projects/proj-settings")
    await expect(page.locator('[data-testid="project-dashboard"]')).toBeVisible({ timeout: 15_000 })

    const settingsTab = page.getByTestId("project-tab-settings")
    await expect(settingsTab).toBeVisible()
    await settingsTab.click()
    await expect(settingsTab).toHaveAttribute("data-active", "true")

    const panel = page.getByTestId("pid-settings-panel")
    await expect(panel).toBeVisible({ timeout: 10_000 })
    await expect(page.getByTestId("pid-settings-default-skills")).toBeVisible()
    // The global default skill is always surfaced as a chip and pre-selected.
    await expect(page.locator('[data-skill="goal"]')).toBeVisible()
    await expect(page.locator('[data-skill="goal"]')).toHaveAttribute("data-selected", "true")
  })

  test("editing the default skills persists across reload", async ({ page }) => {
    ensureProject("proj-settings-save", { gitInit: true })

    await page.goto("/projects/proj-settings-save?tab=settings")
    await expect(page.getByTestId("pid-settings-panel")).toBeVisible({ timeout: 15_000 })

    const goal = page.locator('[data-skill="goal"]')
    await expect(goal).toHaveAttribute("data-selected", "true")

    // Save is disabled until the working copy diverges from what's stored.
    const save = page.getByTestId("pid-settings-save")
    await expect(save).toBeDisabled()

    // Deselect the default → dirty → Save.
    await goal.click()
    await expect(goal).toHaveAttribute("data-selected", "false")
    await expect(save).toBeEnabled()
    await save.click()
    await expect(save).toBeDisabled() // back to clean after a successful save

    // Reload: the empty selection must have persisted to .pid/settings.json.
    await page.reload()
    await expect(page.getByTestId("pid-settings-panel")).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('[data-skill="goal"]')).toHaveAttribute("data-selected", "false")
  })
})
