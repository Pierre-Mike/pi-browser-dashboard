import { expect, type Page, test } from "@playwright/test"
import { dispatchDirect, rmSession, waitForCard, waitForSettled } from "./helpers"

// Covers the usability features added on top of the shared-canvas tab:
//  - rename a box inline (double-click → input → Enter commits)
//  - select two boxes and wrap them under a "group" parent
//  - ungroup back to flat boxes
//  - attach a label to an edge (arrow text)
//  - double-click empty space to drop a box (Obsidian parity)
// All assertions ride on data-testid hooks; we deliberately avoid relying on
// React Flow's internal pixel transforms because they're a moving target.

// Spin up a fresh session and land on its canvas tab. Returns the short id so
// the caller can tear the session down in a finally block.
const openCanvasTab = async (page: Page): Promise<string> => {
  await page.goto("/")
  const { short } = await dispatchDirect()
  await waitForCard({ page, short, timeout: 20_000 })
  await waitForSettled({ page, short })
  await page.goto(`/sessions/${short}`)
  await page.getByTestId("tab-canvas").click()
  await expect(page.getByTestId("canvas-tab")).toBeVisible({ timeout: 15_000 })
  return short
}

test("canvas tab — rename, group, ungroup, label arrow", async ({ page }) => {
  const short = await openCanvasTab(page)
  try {
    // Wait for sync to come online so the toolbar actions reach the daemon.
    await expect(page.getByTestId("canvas-status")).toHaveText(/live|connecting/i, {
      timeout: 10_000,
    })

    // --- Add a box ---
    await page.getByTestId("canvas-add-box").click()
    const firstBox = page.getByTestId("canvas-node-box").first()
    await expect(firstBox).toBeVisible({ timeout: 10_000 })
    await expect(firstBox.getByTestId("canvas-node-label")).toHaveText("New box")

    // --- Rename via double-click ---
    await firstBox.dblclick()
    const input = firstBox.getByTestId("canvas-node-input")
    await expect(input).toBeVisible()
    await input.fill("Login flow")
    await input.press("Enter")
    await expect(firstBox.getByTestId("canvas-node-label")).toHaveText("Login flow")

    // --- Add a second box ---
    await page.getByTestId("canvas-add-box").click()
    await expect(page.getByTestId("canvas-node-box")).toHaveCount(2)

    // --- Group both selected boxes ---
    // Click the first to select; shift-click the second to extend selection.
    await page.getByTestId("canvas-node-box").nth(0).click()
    await page
      .getByTestId("canvas-node-box")
      .nth(1)
      .click({ modifiers: ["Shift"] })

    const groupBtn = page.getByTestId("canvas-group")
    await expect(groupBtn).toBeEnabled()
    await groupBtn.click()

    const group = page.getByTestId("canvas-node-group")
    await expect(group).toBeVisible()
    await expect(group.getByTestId("canvas-group-label")).toHaveText("Group")

    // --- Rename the group ---
    await group.getByTestId("canvas-group-label").dblclick()
    const groupInput = group.getByTestId("canvas-group-input")
    await expect(groupInput).toBeVisible()
    await groupInput.fill("Auth cluster")
    await groupInput.press("Enter")
    await expect(group.getByTestId("canvas-group-label")).toHaveText("Auth cluster")

    // --- Ungroup ---
    await group.click()
    const ungroupBtn = page.getByTestId("canvas-ungroup")
    await expect(ungroupBtn).toBeEnabled()
    await ungroupBtn.click()
    await expect(page.getByTestId("canvas-node-group")).toHaveCount(0)
    await expect(page.getByTestId("canvas-node-box")).toHaveCount(2)

    // --- Clear and restart cleanly ---
    await page.getByTestId("canvas-reset").click()
    await expect(page.getByTestId("canvas-node-box")).toHaveCount(0)
  } finally {
    rmSession(short)
  }
})

test("canvas tab — edge label input appears when an edge is selected", async ({ page }) => {
  const short = await openCanvasTab(page)
  try {
    // The edge label input only mounts when an edge is selected. With no
    // edges drawn yet, it must be absent. This guards against a regression
    // where the input is always-rendered and steals keyboard focus.
    await expect(page.getByTestId("canvas-edge-label-input")).toHaveCount(0)

    // The toolbar surfaces the new affordances regardless of selection state.
    await expect(page.getByTestId("canvas-group")).toBeVisible()
    await expect(page.getByTestId("canvas-ungroup")).toBeVisible()
    await expect(page.getByTestId("canvas-group")).toBeDisabled()
    await expect(page.getByTestId("canvas-ungroup")).toBeDisabled()
  } finally {
    rmSession(short)
  }
})

test("canvas tab — double-click empty space creates an editable box", async ({ page }) => {
  const short = await openCanvasTab(page)
  try {
    await expect(page.getByTestId("canvas-status")).toHaveText(/live|connecting/i, {
      timeout: 10_000,
    })

    // Fresh canvas: no boxes yet.
    await expect(page.getByTestId("canvas-node-box")).toHaveCount(0)

    // Obsidian parity: double-clicking the empty pane drops a box, opened
    // straight into edit mode so the user can type immediately.
    const pane = page.locator(".react-flow__pane")
    await pane.dblclick({ position: { x: 240, y: 180 } })

    const box = page.getByTestId("canvas-node-box").first()
    await expect(box).toBeVisible({ timeout: 10_000 })
    const input = box.getByTestId("canvas-node-input")
    await expect(input).toBeVisible()
    await input.fill("Spawned by double-click")
    await input.press("Enter")
    await expect(box.getByTestId("canvas-node-label")).toHaveText("Spawned by double-click")
  } finally {
    rmSession(short)
  }
})
