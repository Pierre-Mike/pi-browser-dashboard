import { expect, test } from "@playwright/test"
import { ensureProject } from "./helpers"

// The test-extension is a local iframe-tier extension seeded by global-setup.
// It contributes a projectPanel so it appears in the project view after Settings.
test.describe("test-extension project panel", () => {
  test("tab appears after Settings and renders a button", async ({ page }) => {
    ensureProject("test-ext-proj", { gitInit: true })

    await page.goto("/projects/test-ext-proj")
    await expect(page.getByTestId("project-dashboard")).toBeVisible({ timeout: 15_000 })

    // Settings tab must exist — test-extension tab comes after it.
    const settingsTab = page.getByTestId("project-tab-settings")
    await expect(settingsTab).toBeVisible()

    // The extension contributes a projectPanel; its tab key is ext:test-extension.
    const extTab = page.getByTestId("project-tab-ext:test-extension")
    await expect(extTab).toBeVisible({ timeout: 15_000 })
    await expect(extTab).toContainText("test-extension")

    // The Settings tab must appear before the extension tab in the DOM.
    const settingsIndex = await settingsTab.evaluate((el) => {
      const tabs = Array.from(document.querySelectorAll('[role="tab"]'))
      return tabs.indexOf(el)
    })
    const extIndex = await extTab.evaluate((el) => {
      const tabs = Array.from(document.querySelectorAll('[role="tab"]'))
      return tabs.indexOf(el)
    })
    expect(extIndex).toBeGreaterThan(settingsIndex)

    // Click the extension tab — panel becomes visible, iframe loads.
    await extTab.click()
    await expect(extTab).toHaveAttribute("data-active", "true")

    const panel = page.getByTestId("project-tab-panel-ext-test-extension")
    await expect(panel).toBeVisible()

    const frame = page.frameLocator('[data-testid="extension-host-test-extension"]')
    await expect(frame.getByTestId("test-extension-button")).toBeVisible({ timeout: 15_000 })
    await expect(frame.getByTestId("test-extension-button")).toContainText("Test Extension")
  })
})
