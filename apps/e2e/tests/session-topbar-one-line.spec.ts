import { expect, test } from "@playwright/test"
import { openSessionPage, rmSession, spawnSettled } from "./helpers"

// Regression: the session drill-in spent TWO rows of chrome — a <header> with
// the title/badge/actions, then a bordered tab strip underneath — while the
// project page fits identity, tabs and actions on ONE row. That second row cost
// every session's terminal / chat pane ~50px of height.
//
// Per SES-C002 the reclaim is asserted in pixels, not class names: the old
// two-row chrome pushed the terminal pane to y≈80; one row lands it under 48.
const MAX_CHROME_PX = 48

test("session topbar puts identity, tab dock and actions on one row", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.goto("/")
  const short = await spawnSettled(page)
  try {
    await openSessionPage(page, short)

    const topbar = page.getByTestId("session-topbar")
    await expect(topbar).toBeVisible()

    // Every control the topbar owns must sit inside it — not in a row below.
    for (const id of ["session-tabs", "tab-terminal", "tab-chat", "tab-canvas", "tab-files"]) {
      await expect(topbar.getByTestId(id)).toBeVisible()
    }

    const box = await topbar.boundingBox()
    if (!box) throw new Error("topbar should have a bounding box")
    expect(box.height).toBeLessThan(MAX_CHROME_PX)

    // The tab dock is vertically centred in the same band as the title, which
    // only holds while they share a row.
    const tab = await page.getByTestId("tab-terminal").boundingBox()
    const title = await page.getByRole("heading", { level: 1 }).boundingBox()
    if (!tab || !title) throw new Error("tab and title should have bounding boxes")
    expect(Math.abs(tab.y + tab.height / 2 - (title.y + title.height / 2))).toBeLessThan(12)

    // Terminal is the default tab: its pane must start directly under the one
    // row of chrome. Two rows put it at ~80px.
    const pane = await page.getByTestId("terminal-tab").boundingBox()
    if (!pane) throw new Error("terminal pane should have a bounding box")
    expect(pane.y).toBeLessThan(MAX_CHROME_PX)
  } finally {
    rmSession(short)
  }
})
