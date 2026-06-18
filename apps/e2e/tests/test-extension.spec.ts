import { cpSync, rmSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "@playwright/test"
import { ensureProject, extLocalDir, restartDaemon } from "./helpers"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// TDD: test-extension is NOT globally seeded by global-setup.ts.
// Before this describe block's beforeAll seeds it, no project should have the tab.
test("test-extension absent from projects before local seeding", async ({ page }) => {
  ensureProject("no-ext-proj", { gitInit: true })
  await page.goto("/projects/no-ext-proj")
  await expect(page.getByTestId("project-dashboard")).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId("project-tab-ext:test-extension")).not.toBeVisible()
})

// The test-extension is a LOCAL iframe-tier extension seeded per-spec.
// Source lives in apps/e2e/fixtures/extensions/test-extension/ (e2e-internal, not a public example).
// It contributes a projectPanel so it appears in the project view after Settings.
test.describe("test-extension project panel", () => {
  test.beforeAll(async () => {
    const extDir = extLocalDir()
    const fixtureDir = join(__dirname, "..", "fixtures", "extensions", "test-extension")
    cpSync(fixtureDir, join(extDir, "test-extension"), { recursive: true })
    await restartDaemon()
  })

  test.afterAll(async () => {
    const extDir = extLocalDir()
    rmSync(join(extDir, "test-extension"), { recursive: true, force: true })
    await restartDaemon()
  })

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

    // The dashboard container must use h-screen when an ext: tab is active,
    // so the iframe fills the viewport without X/Y scrollbars.
    const dashboard = page.getByTestId("project-dashboard")
    const dashClass = await dashboard.getAttribute("class")
    expect(dashClass).toContain("h-screen")
  })
})
