import { expect, test } from "@playwright/test"
import {
  cardLocator,
  dispatchDirect,
  ensureProject,
  rmSession,
  waitForCard,
  waitForSettled,
} from "./helpers"

test("dispatch via sidebar + button: card appears in grid, reaches done", async ({ page }) => {
  ensureProject("proj-spawn-sidebar", { gitInit: true })
  await page.goto("/")

  // Sidebar `+` is only rendered for known projects — wait until at least one shows up.
  const spawnBtn = page.locator('[data-testid="sidebar-spawn"]').first()
  await expect(spawnBtn).toBeVisible({ timeout: 15_000 })

  const dispatchResp = page.waitForResponse(
    (r) => r.url().endsWith("/dispatch") && r.request().method() === "POST" && r.ok(),
    { timeout: 15_000 },
  )
  await spawnBtn.click()
  const modal = page.locator('[data-testid="spawn-modal"]')
  await expect(modal).toBeVisible()

  // Regression guard: modal must escape the sidebar's stacking context and span
  // the full viewport. Caught a bug where the modal was rendered inside <aside>
  // and visually clipped to the sidebar column.
  const overlay = await modal.boundingBox()
  const viewport = page.viewportSize()
  if (!overlay || !viewport) throw new Error("missing bounding box / viewport")
  expect(overlay.width).toBeGreaterThanOrEqual(viewport.width - 1)
  expect(overlay.height).toBeGreaterThanOrEqual(viewport.height - 1)
  expect(overlay.x).toBeLessThanOrEqual(1)
  expect(overlay.y).toBeLessThanOrEqual(1)

  // Modal must be a direct child of <body>, not nested inside the sidebar tree.
  const parentTag = await modal.evaluate((el) => el.parentElement?.tagName.toLowerCase() ?? null)
  expect(parentTag).toBe("body")

  const modalInput = page.getByPlaceholder("What should this session do?")
  await expect(modalInput).toBeVisible()
  await modalInput.fill("say hello and exit")
  await page.getByRole("button", { name: "Spawn", exact: true }).click()
  const resp = await dispatchResp
  const { short } = (await resp.json()) as { short: string }

  try {
    await waitForCard({ page, short, timeout: 20_000 })
    await waitForSettled({ page, short })
    await expect(cardLocator(page, short)).toContainText(short)
  } finally {
    rmSession(short)
  }
})

test("dispatch via daemon API: card appears, reaches done", async ({ page }) => {
  await page.goto("/")
  const { short } = await dispatchDirect()
  try {
    await waitForCard({ page, short, timeout: 20_000 })
    await waitForSettled({ page, short })
  } finally {
    rmSession(short)
  }
})
