import { expect, test } from "@playwright/test"
import {
  cardLocator,
  dispatchDirect,
  ensureProject,
  rmSession,
  waitForCard,
  waitForSessionInRegistry,
} from "./helpers"

test("click sidebar project link → navigate to /projects/$id dashboard", async ({ page }) => {
  const projectPath = ensureProject("proj-dash", { gitInit: true })
  const { short } = await dispatchDirect(undefined, { cwd: projectPath })
  await waitForSessionInRegistry(short)

  try {
    await page.goto("/")

    // The home page leads with a cross-project activity feed; the sidebar
    // project link is the affordance into a project's own dashboard.
    const link = page.locator('[data-testid="sidebar-project-link"][data-project-id="proj-dash"]')
    await expect(link).toBeVisible({ timeout: 15_000 })
    await expect(link).toHaveAttribute("href", "/projects/proj-dash")
    await link.click()
    await expect(page).toHaveURL(/\/projects\/proj-dash$/)

    // Dashboard must show the project name and the session card. The absolute
    // path is no longer an always-visible row — it's a tooltip (title) on the
    // project name, discoverable the same way the branch/GitHub titles are.
    const dash = page.locator('[data-testid="project-dashboard"]')
    await expect(dash).toBeVisible()
    await expect(dash).toContainText("proj-dash")
    await expect(page.locator('[data-testid="project-topbar"] h1')).toHaveAttribute(
      "title",
      projectPath,
    )

    await waitForCard({ page, short, timeout: 20_000 })
    await expect(dash.locator(cardLocator(page, short))).toHaveCount(1)

    // Spawn button is available on the dashboard.
    await expect(page.getByTestId("dashboard-spawn")).toBeVisible()
  } finally {
    rmSession(short)
  }
})

test("sidebar project title links to /projects/$id dashboard", async ({ page }) => {
  const projectPath = ensureProject("proj-dash-sidebar", { gitInit: true })
  const { short } = await dispatchDirect(undefined, { cwd: projectPath })
  await waitForSessionInRegistry(short)

  try {
    await page.goto("/")
    const link = page.locator(
      '[data-testid="sidebar-project-link"][data-project-id="proj-dash-sidebar"]',
    )
    await expect(link).toBeVisible({ timeout: 15_000 })
    await expect(link).toHaveAttribute("href", "/projects/proj-dash-sidebar")

    await link.click()
    await expect(page).toHaveURL(/\/projects\/proj-dash-sidebar$/)
    await expect(page.locator('[data-testid="project-dashboard"]')).toBeVisible()
  } finally {
    rmSession(short)
  }
})

// Regression: the dashboard top used to spend two stacked rows (a header row,
// then the tab dock row) on identity + controls. They now share one line.
test("project dashboard topbar collapses to a single line", async ({ page }) => {
  const projectPath = ensureProject("proj-dash-density", { gitInit: true })
  const { short } = await dispatchDirect(undefined, { cwd: projectPath })
  await waitForSessionInRegistry(short)

  try {
    await page.goto("/projects/proj-dash-density")
    await expect(page.locator('[data-testid="project-dashboard"]')).toBeVisible()

    const topbar = page.getByTestId("project-topbar")
    await expect(topbar).toBeVisible()
    const box = await topbar.boundingBox()
    expect(box).not.toBeNull()
    // One line of controls at a comfortable desktop width, not a wrapped block.
    expect(box?.height).toBeLessThan(44)

    // The tab dock and Spawn button both live inside that single-line row and
    // stay visible — density isn't achieved by hiding functional controls.
    const tabs = page.getByTestId("project-tabs")
    const spawn = page.getByTestId("dashboard-spawn")
    await expect(tabs).toBeVisible()
    await expect(spawn).toBeVisible()

    const tabsBox = await tabs.boundingBox()
    const spawnBox = await spawn.boundingBox()
    expect(tabsBox).not.toBeNull()
    expect(spawnBox).not.toBeNull()
    if (box && tabsBox && spawnBox) {
      expect(tabsBox.y).toBeGreaterThanOrEqual(box.y)
      expect(tabsBox.y + tabsBox.height).toBeLessThanOrEqual(box.y + box.height + 1)
      expect(spawnBox.y).toBeGreaterThanOrEqual(box.y)
      expect(spawnBox.y + spawnBox.height).toBeLessThanOrEqual(box.y + box.height + 1)
    }
  } finally {
    rmSession(short)
  }
})
