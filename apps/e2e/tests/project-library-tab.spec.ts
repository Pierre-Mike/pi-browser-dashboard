import { expect, test } from "@playwright/test"
import { ensureProject } from "./helpers"

// The project dashboard exposes a Library tab so skills/hooks can be managed
// from within a specific project. Unlike the global Library view, the project
// scope wires `projectId` through, which enables the local install / push /
// sync affordances. These tests assume the developer's local library.yaml
// exists (same assumption as library.spec.ts).
test.describe("project library tab", () => {
  test("project dashboard exposes a Library tab that opens the library panel", async ({ page }) => {
    ensureProject("proj-lib", { gitInit: true })

    await page.goto("/projects/proj-lib")
    await expect(page.locator('[data-testid="project-dashboard"]')).toBeVisible({ timeout: 15_000 })

    const libraryTab = page.getByTestId("project-tab-library")
    await expect(libraryTab).toBeVisible()
    await libraryTab.click()
    await expect(libraryTab).toHaveAttribute("data-active", "true")

    const panel = page.getByTestId("library-panel")
    await expect(panel).toBeVisible({ timeout: 10_000 })
    await expect(page.getByTestId("library-search-skills")).toBeVisible()
  })

  test("library entries can be installed/removed locally from the project scope", async ({
    page,
  }) => {
    ensureProject("proj-lib-local", { gitInit: true })

    await page.goto("/projects/proj-lib-local")
    await expect(page.locator('[data-testid="project-dashboard"]')).toBeVisible({ timeout: 15_000 })
    await page.getByTestId("project-tab-library").click()
    await expect(page.getByTestId("library-panel")).toBeVisible({ timeout: 10_000 })

    const firstSkill = page.locator('[data-testid^="library-entry-skills-"]').first()
    await expect(firstSkill).toBeVisible()
    await firstSkill.click()

    // Project scope threads projectId → the local install/push affordances are
    // ENABLED here (they are disabled in the global view), and Remove is shown.
    const installLocal = page.locator('[data-testid^="library-action-install-local-"]').first()
    await expect(installLocal).toBeEnabled()
    const remove = page.locator('[data-testid^="library-action-remove-"]').first()
    await expect(remove).toBeVisible()

    // The local sync scope is selectable (not disabled) in a project context.
    const scope = page.getByTestId("library-sync-scope")
    await scope.selectOption("local")
    await expect(scope).toHaveValue("local")
  })
})
