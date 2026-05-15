import { expect, test } from "@playwright/test"
import {
  cardLocator,
  dispatchDirect,
  ensureProject,
  rmSession,
  waitForCard,
  waitForSessionInRegistry,
} from "./helpers"

test("click project bar on grid → navigate to /projects/$id dashboard", async ({ page }) => {
  const projectPath = ensureProject("proj-dash", { gitInit: true })
  const { short } = await dispatchDirect(undefined, { cwd: projectPath })
  await waitForSessionInRegistry(short)

  try {
    await page.goto("/")

    const section = page.locator('[data-testid="project-section"][data-project-id="proj-dash"]')
    await expect(section).toBeVisible({ timeout: 15_000 })

    // The project bar (title row) must be a link to the project dashboard.
    const bar = section.locator('[data-testid="project-bar"]')
    await expect(bar).toHaveAttribute("href", "/projects/proj-dash")
    await bar.click()
    await expect(page).toHaveURL(/\/projects\/proj-dash$/)

    // Dashboard must show the project name, path hint, and the session card.
    const dash = page.locator('[data-testid="project-dashboard"]')
    await expect(dash).toBeVisible()
    await expect(dash).toContainText("proj-dash")
    await expect(dash).toContainText(projectPath)

    await waitForCard(page, short, 20_000)
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
