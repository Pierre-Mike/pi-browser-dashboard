import { expect, type Locator, type Page, test } from "@playwright/test"
import { dispatchDirect, rmSession, waitForCard, waitForSettled } from "./helpers"

// The user story this file guards: "I create a link between two boxes, I have
// a line, and I want to put a name on it." Double-clicking the line must open
// a focused editor right at the line's midpoint, typing + Enter must paint the
// text on the line, and the name must survive a full reload (daemon
// round-trip). Before the inline editor existed, a double-click on the line
// selected it silently and typing went nowhere — hence the focus assertion.

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

const boxByName = (page: Page, name: string): Locator =>
  page.locator(".react-flow__node", { hasText: name })

// Drop a named box by double-clicking empty canvas, then drag it to a spot
// given as fractions of the pane so the layout is deterministic regardless of
// the zoom level fitView picked (it zooms onto the first box created).
const placeBox = async (args: {
  page: Page
  name: string
  at: { fx: number; fy: number }
}): Promise<void> => {
  const pane = args.page.locator(".react-flow__pane")
  const paneBox = await pane.boundingBox()
  if (!paneBox) throw new Error("pane not on screen")
  const target = {
    x: paneBox.x + paneBox.width * args.at.fx,
    y: paneBox.y + paneBox.height * args.at.fy,
  }
  await pane.dblclick({ position: { x: target.x - paneBox.x, y: target.y - paneBox.y } })
  const input = args.page.getByTestId("canvas-node-input")
  await expect(input).toBeVisible()
  await input.fill(args.name)
  await input.press("Enter")
  // The double-click may have landed while fitView was still settling; drag
  // the box by its body onto the exact target point.
  const box = await boxByName(args.page, args.name).boundingBox()
  if (!box) throw new Error(`box ${args.name} not on screen`)
  await args.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await args.page.mouse.down()
  await args.page.mouse.move(target.x, target.y, { steps: 10 })
  await args.page.mouse.up()
}

// Drag from the source box's right-side source handle to the target box's
// left edge. React Flow's connectionRadius snaps the drop to the nearest
// valid target handle, so aiming at the box edge is enough.
const connectBoxes = async (args: { page: Page; from: string; to: string }): Promise<void> => {
  const handle = boxByName(args.page, args.from).locator(".react-flow__handle-right.source")
  const handleBox = await handle.boundingBox()
  const targetBox = await boxByName(args.page, args.to).boundingBox()
  if (!handleBox || !targetBox) throw new Error("handle or box not on screen")
  await args.page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2)
  await args.page.mouse.down()
  await args.page.mouse.move(targetBox.x + 4, targetBox.y + targetBox.height / 2, { steps: 12 })
  await args.page.mouse.up()
}

// The line's midpoint in screen coordinates. React Flow's bezier passes
// through the exact midpoint of its endpoints (right-center of the source box
// to left-center of the target box), so this is always a point ON the line.
const edgeMidpoint = async (args: {
  page: Page
  from: string
  to: string
}): Promise<{ x: number; y: number }> => {
  const from = await boxByName(args.page, args.from).boundingBox()
  const to = await boxByName(args.page, args.to).boundingBox()
  if (!from || !to) throw new Error("boxes not on screen")
  return {
    x: (from.x + from.width + to.x) / 2,
    y: (from.y + from.height / 2 + (to.y + to.height / 2)) / 2,
  }
}

test("canvas tab — double-click a connection line, type, and the name sticks", async ({ page }) => {
  const short = await openCanvasTab(page)
  try {
    await expect(page.getByTestId("canvas-status")).toHaveText(/live/i, { timeout: 10_000 })

    // Two boxes with real distance between them.
    await placeBox({ page, name: "Web app", at: { fx: 0.2, fy: 0.25 } })
    await placeBox({ page, name: "Database", at: { fx: 0.75, fy: 0.7 } })
    await expect(page.getByTestId("canvas-node-box")).toHaveCount(2)

    // Connect them with a drag — the user's "I have a line".
    await connectBoxes({ page, from: "Web app", to: "Database" })
    await expect(page.locator(".react-flow__edge")).toHaveCount(1)

    // Double-click the middle of the line: a focused editor opens right
    // there. Typing must land in it — not on the canvas, not in a new box.
    const mid = await edgeMidpoint({ page, from: "Web app", to: "Database" })
    await page.mouse.dblclick(mid.x, mid.y)
    await expect(page.getByTestId("canvas-node-box")).toHaveCount(2)
    await expect(page.getByTestId("canvas-edge-label-inline")).toBeFocused()
    await page.keyboard.type("depends on")
    await page.keyboard.press("Enter")

    // The name renders on the line itself.
    await expect(page.getByTestId("canvas-edge-label-text")).toHaveText("depends on")

    // And it survives a daemon round-trip: reload, reopen the canvas tab.
    await page.waitForTimeout(800)
    await page.reload()
    await expect(page.getByTestId("canvas-tab")).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId("canvas-edge-label-text")).toHaveText("depends on", {
      timeout: 10_000,
    })
  } finally {
    rmSession(short)
  }
})

test("canvas tab — renaming via the line's label chip", async ({ page }) => {
  const short = await openCanvasTab(page)
  try {
    await expect(page.getByTestId("canvas-status")).toHaveText(/live/i, { timeout: 10_000 })

    await placeBox({ page, name: "Alpha", at: { fx: 0.2, fy: 0.25 } })
    await placeBox({ page, name: "Beta", at: { fx: 0.75, fy: 0.7 } })
    await connectBoxes({ page, from: "Alpha", to: "Beta" })

    const mid = await edgeMidpoint({ page, from: "Alpha", to: "Beta" })
    await page.mouse.dblclick(mid.x, mid.y)
    await page.keyboard.type("v1")
    await page.keyboard.press("Enter")
    await expect(page.getByTestId("canvas-edge-label-text")).toHaveText("v1")

    // Double-click the existing name to rename in place; Escape cancels.
    await page.getByTestId("canvas-edge-label-text").dblclick()
    const editor = page.getByTestId("canvas-edge-label-inline")
    await expect(editor).toBeFocused()
    await page.keyboard.type("v2")
    await page.keyboard.press("Escape")
    await expect(page.getByTestId("canvas-edge-label-text")).toHaveText("v1")

    // And renaming for real commits.
    await page.getByTestId("canvas-edge-label-text").dblclick()
    await editor.fill("calls into")
    await page.keyboard.press("Enter")
    await expect(page.getByTestId("canvas-edge-label-text")).toHaveText("calls into")
  } finally {
    rmSession(short)
  }
})
