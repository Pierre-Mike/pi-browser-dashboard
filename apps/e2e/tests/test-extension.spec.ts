import { cpSync, mkdirSync, rmSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "@playwright/test"
import { ensureProject, restartDaemon } from "./helpers"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// A LOCAL extension is owned by the project whose `.pid/extensions/<name>` dir
// holds it (the repo root, three levels up). We seed the fixture into the owning
// project's own `.pid/extensions` and point the daemon's local root there, so
// the daemon resolves the ext's projectPath to that project and the dashboard
// scopes its panel to that project only — not to every project.
const OWNER = "test-ext-proj"

// TDD: test-extension is NOT globally seeded by global-setup.ts.
// Before this describe block's beforeAll seeds it, no project should have the tab.
test("test-extension absent from projects before local seeding", async ({ page }) => {
  ensureProject("no-ext-proj", { gitInit: true })
  await page.goto("/projects/no-ext-proj")
  await expect(page.getByTestId("project-dashboard")).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId("project-tab-ext:test-extension")).not.toBeVisible()
})

// The test-extension is a LOCAL iframe-tier extension seeded per-spec into its
// owning project's `.pid/extensions`. Source lives in
// apps/e2e/fixtures/extensions/test-extension/ (e2e-internal, not a public example).
// It contributes a projectPanel so it appears in the owning project's view after Settings.
test.describe("test-extension project panel", () => {
  test.beforeAll(async () => {
    const ownerPath = ensureProject(OWNER, { gitInit: true })
    const ownerExtRoot = join(ownerPath, ".pid", "extensions")
    mkdirSync(ownerExtRoot, { recursive: true })
    const fixtureDir = join(__dirname, "..", "fixtures", "extensions", "test-extension")
    cpSync(fixtureDir, join(ownerExtRoot, "test-extension"), { recursive: true })
    // Point the daemon's local root at the owning project's `.pid/extensions`
    // so the ext loads as local with projectPath === ownerPath.
    await restartDaemon({ PID_EXT_LOCAL_DIR: ownerExtRoot })
  })

  test.afterAll(async () => {
    const ownerExtRoot = join(ensureProject(OWNER), ".pid", "extensions")
    rmSync(join(ownerExtRoot, "test-extension"), { recursive: true, force: true })
    // Restore the default local root for subsequent specs.
    await restartDaemon()
  })

  test("scoped to its owning project only, not every project", async ({ page }) => {
    // A sibling project that does NOT own the extension must not show its tab.
    ensureProject("other-proj", { gitInit: true })
    await page.goto("/projects/other-proj")
    await expect(page.getByTestId("project-dashboard")).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId("project-tab-ext:test-extension")).not.toBeVisible()
  })

  test("tab appears after Settings and renders a button", async ({ page }) => {
    await page.goto(`/projects/${OWNER}`)
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
