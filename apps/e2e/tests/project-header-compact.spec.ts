import { expect, test } from "@playwright/test"
import { ensureProject } from "./helpers"

// The project dashboard header must remain compact so the active tab gets
// the vertical real estate. Regression guard for the collapse from a
// five-row header (back-link / title / path / pills / tabs) into a single
// wrapping row immediately above the tab bar.
test("project dashboard header collapses to a single wrapping row above the tabs", async ({
  page,
}) => {
  ensureProject("proj-header-compact", { gitInit: true })

  await page.goto("/projects/proj-header-compact")
  const dash = page.locator('[data-testid="project-dashboard"]')
  await expect(dash).toBeVisible({ timeout: 15_000 })

  // Header sits directly above the tab bar — distance from the top of the
  // header to the top of the tab bar bounds the header's total height.
  const header = dash.locator("header").first()
  const tabs = page.getByTestId("project-tabs")
  await expect(header).toBeVisible()
  await expect(tabs).toBeVisible()

  const headerBox = await header.boundingBox()
  const tabsBox = await tabs.boundingBox()
  if (!headerBox || !tabsBox) throw new Error("missing bounding boxes")

  const headerHeight = tabsBox.y - headerBox.y
  // Pre-compaction the header occupied ~140-160px (4 rows + borders + gap-4).
  // The single-row design fits comfortably under 64px on the default viewport.
  expect(headerHeight).toBeLessThan(64)

  // "All projects" back text was replaced with a bare ← arrow.
  await expect(header).not.toContainText("All projects")

  // Idle / done / stopped / total pills were removed from the header so they
  // can't reappear and re-bloat the row. (working / needs_input / failed
  // remain — but only when there are sessions in those states.)
  await expect(header).not.toContainText(/\bidle\b/)
  await expect(header).not.toContainText(/\bdone\b/)
  await expect(header).not.toContainText(/\bstopped\b/)
  await expect(header).not.toContainText(/\btotal\b/)
})
