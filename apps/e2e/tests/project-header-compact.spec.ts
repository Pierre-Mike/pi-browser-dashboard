import { expect, test } from "@playwright/test"
import { ensureProject } from "./helpers"

// The project dashboard top must remain compact so the active tab gets the
// vertical real estate. Regression guard for the collapse from a five-row
// header (back-link / title / path / pills / tabs) down to ONE row — the
// identity cluster and the tab dock itself now share the same line rather
// than the dock sitting in a separate row below a header.
test("project dashboard top collapses to a single line that includes the tab dock", async ({
  page,
}) => {
  ensureProject("proj-header-compact", { gitInit: true })

  await page.goto("/projects/proj-header-compact")
  const dash = page.locator('[data-testid="project-dashboard"]')
  await expect(dash).toBeVisible({ timeout: 15_000 })

  const topbar = page.getByTestId("project-topbar")
  const tabs = page.getByTestId("project-tabs")
  await expect(topbar).toBeVisible()
  await expect(tabs).toBeVisible()

  const topbarBox = await topbar.boundingBox()
  const tabsBox = await tabs.boundingBox()
  if (!topbarBox || !tabsBox) throw new Error("missing bounding boxes")

  // The tab dock lives INSIDE the topbar row now, not in a row below it.
  expect(tabsBox.y).toBeGreaterThanOrEqual(topbarBox.y)
  expect(tabsBox.y + tabsBox.height).toBeLessThanOrEqual(topbarBox.y + topbarBox.height + 1)

  // Pre-compaction the header alone occupied ~140-160px (4 rows + gap-4)
  // before even reaching the tab dock below it. The whole row — identity,
  // dock, pills, Spawn — now fits comfortably under 44px on the default
  // viewport.
  expect(topbarBox.height).toBeLessThan(44)

  // "All projects" back text was replaced with a bare ← arrow.
  await expect(topbar).not.toContainText("All projects")

  // Idle / done / stopped / total pills were removed from the row so they
  // can't reappear and re-bloat it. (working / needs_input / failed remain —
  // but only when there are sessions in those states.)
  await expect(topbar).not.toContainText(/\bidle\b/)
  await expect(topbar).not.toContainText(/\bdone\b/)
  await expect(topbar).not.toContainText(/\bstopped\b/)
  await expect(topbar).not.toContainText(/\btotal\b/)
})
