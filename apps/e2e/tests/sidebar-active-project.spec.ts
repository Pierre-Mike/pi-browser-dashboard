import { expect, test } from "@playwright/test"
import { dispatchDirect, ensureProject, rmSession, waitForSessionInRegistry } from "./helpers"

// The sidebar project row must show a selected state while its
// /projects/$id dashboard is open, and drop it when navigating away.
test("sidebar project highlights while its dashboard page is open", async ({ page }) => {
  const projectPath = ensureProject("proj-active", { gitInit: true })
  const { short } = await dispatchDirect(undefined, { cwd: projectPath })
  await waitForSessionInRegistry(short)

  try {
    await page.goto("/")
    const link = page.locator('[data-testid="sidebar-project-link"][data-project-id="proj-active"]')
    await expect(link).toBeVisible({ timeout: 15_000 })
    await expect(link).toHaveAttribute("data-active", "false")

    await link.click()
    await expect(page).toHaveURL(/\/projects\/proj-active$/)
    await expect(link).toHaveAttribute("data-active", "true")

    // Leaving the project page clears the highlight.
    await page.getByTestId("sidebar-projects-link").click()
    await expect(page).toHaveURL(/\/$/)
    await expect(link).toHaveAttribute("data-active", "false")
  } finally {
    rmSession(short)
  }
})
