import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { expect, type Locator, test } from "@playwright/test"
import { dispatchDirect, ensureProject, sessionRootOf, waitForSessionInRegistry } from "./helpers"

// Reducing a left rail must hand over ALL of its width. Both rails used to leave
// a residual strip behind — <main> reserved ~44px to clear a floating reopen
// button, and a collapsed sub-tab rail left a slim ~40px vertical bar — so
// "collapsed" still read as a gap down the left edge. Both reopen controls now
// ride in a row that exists anyway, which is what these measurements lock in.

// Page padding is px-4 (16px); allow a few px of slack for borders/rounding.
const FLUSH_LIMIT = 20

// boundingBox() is nullable for off-screen elements; every element measured here
// has already been awaited visible, so a miss is a bug in the test, not a soft
// case to branch on.
const boxOf = async (locator: Locator) => {
  const box = await locator.boundingBox()
  if (!box) throw new Error("expected a visible element to measure")
  return box
}

test("collapsing the desktop sidebar leaves the page content flush to the left edge", async ({
  page,
}) => {
  await page.goto("/")
  await expect(page.getByTestId("sidebar")).toBeVisible({ timeout: 15_000 })

  // Measure a panel BELOW the top row — the row itself legitimately hosts the chip.
  await page.getByTestId("dashboard-tab-extensions").click()
  const panel = page.getByTestId("dashboard-tab-panel-extensions")
  await expect(panel).toBeVisible()
  const before = await boxOf(panel)

  await page.getByTestId("sidebar-rail-toggle").click()
  await expect(page.getByTestId("sidebar")).not.toBeAttached()

  // The whole sidebar width is reclaimed, down to the page's own padding.
  const after = await boxOf(panel)
  expect(after.x).toBeLessThanOrEqual(FLUSH_LIMIT)
  expect(before.x - after.x).toBeGreaterThan(250)

  // The reopen chip sits inside the tab-dock row, left of the dock, so nothing
  // below it has to leave clearance.
  const chip = page.getByTestId("sidebar-rail-open")
  await expect(chip).toBeVisible()
  const chipBox = await boxOf(chip)
  const dock = await boxOf(page.getByTestId("dashboard-tabs"))
  expect(chipBox.x + chipBox.width).toBeLessThanOrEqual(dock.x + 1)
  expect(chipBox.y).toBeGreaterThanOrEqual(dock.y - 4)

  await chip.click()
  await expect(page.getByTestId("sidebar")).toBeVisible()
})

test("collapsing the Specs rail hands its full width to the spec host", async ({ page }) => {
  const path = ensureProject("flush-demo")
  mkdirSync(join(path, ".pid"), { recursive: true })
  writeFileSync(
    join(path, ".pid", "index.html"),
    "<!doctype html><meta charset='utf-8'><h1 data-testid='flush-app'>FLUSH APP</h1>",
  )

  await page.goto("/projects/flush-demo?tab=pidapps")
  const rail = page.getByTestId("pidapp-subtabs")
  await expect(rail).toBeVisible({ timeout: 15_000 })

  const host = page.getByTestId("project-tab-panel-pidapp-default")
  await expect(host).toBeVisible()
  const before = await boxOf(host)

  await page.getByTestId("pidapp-subtabs-collapse").click()
  // Nothing left where the rail was — not even a slim strip.
  await expect(rail).not.toBeAttached()

  const after = await boxOf(host)
  const section = await boxOf(page.getByTestId("project-tab-panel-pidapps"))
  expect(after.x).toBeLessThanOrEqual(section.x + 1)
  // The w-48 rail plus its gap now belongs to the host.
  expect(before.x - after.x).toBeGreaterThan(150)

  // Its reopen chip lives in the topbar, on the row above the panel.
  const chip = page.getByTestId("pidapp-subtabs-expand")
  await expect(chip).toBeVisible()
  const chipBox = await boxOf(chip)
  const topbar = await boxOf(page.getByTestId("project-topbar"))
  expect(chipBox.y).toBeGreaterThanOrEqual(topbar.y - 1)
  expect(chipBox.y + chipBox.height).toBeLessThanOrEqual(topbar.y + topbar.height + 1)

  await chip.click()
  await expect(rail).toBeVisible()
})

test("collapsing the boards rail hands its full width to the board", async ({ page }) => {
  const cwd = ensureProject("flush-boards")
  const { short } = await dispatchDirect(undefined, { cwd })
  const root = sessionRootOf(await waitForSessionInRegistry(short))
  writeFileSync(
    join(root, "flush-board.canvas"),
    JSON.stringify({
      nodes: [{ id: "n1", type: "text", x: 40, y: 40, width: 200, height: 60, text: "flush idea" }],
      edges: [],
    }),
  )

  await page.goto(`/sessions/${short}?tab=brainstorm`)
  const rail = page.getByTestId("brainstorm-subtabs")
  await expect(rail).toBeVisible({ timeout: 15_000 })

  const board = page.getByTestId("session-board-editor")
  await expect(board).toBeVisible({ timeout: 15_000 })
  const before = await boxOf(board)

  await page.getByTestId("brainstorm-subtabs-collapse").click()
  await expect(rail).not.toBeAttached()

  const after = await boxOf(board)
  expect(before.x - after.x).toBeGreaterThan(120)

  // With the rail gone the reopen chip is the only way back, and it rides inside
  // the section rather than eating a column of the board.
  await page.getByTestId("brainstorm-subtabs-expand").click()
  await expect(rail).toBeVisible()
})
