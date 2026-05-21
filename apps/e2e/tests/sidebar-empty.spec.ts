import { expect, test } from "@playwright/test"
import { ensureProject } from "./helpers"

test("sidebar omits 'no sessions' label under empty projects", async ({ page }) => {
  ensureProject("sidebar-empty-proj", { gitInit: true })

  await page.goto("/")
  const sidebar = page.getByTestId("sidebar")
  await expect(
    sidebar.locator('[data-testid="sidebar-project-link"]', { hasText: "sidebar-empty-proj" }),
  ).toBeVisible({ timeout: 20_000 })

  await expect(sidebar.getByText("no sessions")).toHaveCount(0)
})
