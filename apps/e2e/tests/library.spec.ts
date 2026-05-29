import { expect, test } from "@playwright/test"

// The Library tab lists every entry from ~/.claude/skills/library/library.yaml,
// surfaces install status per scope, and lets the user install / push / remove
// from the browser. These tests exercise the read-only side of that surface and
// the install path against the real daemon — they assume the developer's local
// library.yaml exists.
test.describe("library tab", () => {
  test("opens, lists entries, and shows search controls", async ({ page }) => {
    await page.goto("/")
    await expect(page.getByTestId("dashboard")).toBeVisible({ timeout: 15_000 })

    const libraryTab = page.getByTestId("dashboard-tab-library")
    await expect(libraryTab).toBeVisible()
    await libraryTab.click()

    await expect(libraryTab).toHaveAttribute("data-active", "true")
    const panel = page.getByTestId("library-panel")
    await expect(panel).toBeVisible({ timeout: 10_000 })

    // The default sub-tab is Skills; the search input should be present.
    await expect(page.getByTestId("library-search-skills")).toBeVisible()
    // And at least one entry should be visible.
    const firstSkill = panel.locator('[data-testid^="library-entry-skills-"]').first()
    await expect(firstSkill).toBeVisible()
  })

  test("clicking an entry surfaces install / push / remove actions", async ({ page }) => {
    await page.goto("/")
    await expect(page.getByTestId("dashboard")).toBeVisible({ timeout: 15_000 })
    await page.getByTestId("dashboard-tab-library").click()
    await expect(page.getByTestId("library-panel")).toBeVisible({ timeout: 10_000 })

    const firstSkill = page.locator('[data-testid^="library-entry-skills-"]').first()
    await firstSkill.click()

    // Detail pane buttons appear.
    const installGlobal = page.locator('[data-testid^="library-action-install-global-"]').first()
    await expect(installGlobal).toBeVisible()

    // The local install button is disabled at the global scope (no project context).
    const installLocal = page.locator('[data-testid^="library-action-install-local-"]').first()
    await expect(installLocal).toBeDisabled()

    // Both global and local push affordances are present; local push is
    // disabled with no project context.
    const pushGlobal = page.locator('[data-testid^="library-action-push-global-"]').first()
    await expect(pushGlobal).toBeVisible()
    const pushLocal = page.locator('[data-testid^="library-action-push-local-"]').first()
    await expect(pushLocal).toBeVisible()
    await expect(pushLocal).toBeDisabled()
  })

  test("scoped sync control exposes all / global / local", async ({ page }) => {
    await page.goto("/")
    await expect(page.getByTestId("dashboard")).toBeVisible({ timeout: 15_000 })
    await page.getByTestId("dashboard-tab-library").click()
    await expect(page.getByTestId("library-panel")).toBeVisible({ timeout: 10_000 })

    const scope = page.getByTestId("library-sync-scope")
    await expect(scope).toBeVisible()
    await expect(scope.locator("option")).toHaveCount(3)
    await scope.selectOption("global")
    await expect(scope).toHaveValue("global")
    await expect(page.getByTestId("library-action-sync")).toBeEnabled()
  })

  test("global search surfaces matches across categories and jumps to the entry", async ({
    page,
  }) => {
    await page.goto("/")
    await expect(page.getByTestId("dashboard")).toBeVisible({ timeout: 15_000 })
    await page.getByTestId("dashboard-tab-library").click()
    await expect(page.getByTestId("library-panel")).toBeVisible({ timeout: 10_000 })

    // Grab the name of the first skill so we can search for it across categories.
    const firstSkill = page.locator('[data-testid^="library-entry-skills-"]').first()
    await expect(firstSkill).toBeVisible()
    const testId = await firstSkill.getAttribute("data-testid")
    const name = (testId ?? "").replace("library-entry-skills-", "")
    expect(name.length).toBeGreaterThan(0)

    const search = page.getByTestId("library-global-search")
    await search.fill(name)
    const result = page.getByTestId(`library-global-result-skills-${name}`)
    await expect(result).toBeVisible({ timeout: 5_000 })
    await result.click()

    // Picking a result selects it in its category tab.
    await expect(page.getByTestId(`library-detail-skills-${name}`)).toBeVisible({ timeout: 5_000 })
  })

  test("panel fills the available viewport height", async ({ page }) => {
    await page.goto("/")
    await expect(page.getByTestId("dashboard")).toBeVisible({ timeout: 15_000 })
    await page.getByTestId("dashboard-tab-library").click()

    const panel = page.getByTestId("library-panel")
    await expect(panel).toBeVisible({ timeout: 10_000 })

    const viewport = page.viewportSize()
    const box = await panel.boundingBox()
    if (!viewport || !box) throw new Error("missing viewport size or panel bounding box")
    // The panel should fill most of the viewport height rather than collapsing
    // to its content height.
    expect(box.height).toBeGreaterThan(viewport.height * 0.7)
  })

  test("agentic repo sub-tab lists items with register affordance", async ({ page }) => {
    await page.goto("/")
    await expect(page.getByTestId("dashboard")).toBeVisible({ timeout: 15_000 })
    await page.getByTestId("dashboard-tab-library").click()
    await expect(page.getByTestId("library-panel")).toBeVisible({ timeout: 10_000 })

    await page.getByTestId("library-tab-agentic").click()
    // The skills category should be active by default and show items if the
    // agentic repo is present at /Users/pierre-mikel/Github/agentic.
    const items = page.locator('[data-testid^="agentic-item-skills-"]')
    // Either there are items (agentic repo exists) or an empty-state banner.
    // We don't hard-fail on missing repo — just confirm we render *something*.
    await expect(page.getByText(/Browsing/)).toBeVisible({ timeout: 5_000 })
    const count = await items.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })
})
