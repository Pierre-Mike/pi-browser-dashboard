import { expect, test } from "@playwright/test"
import { dispatchDirect } from "./helpers"

// Sidebar session-list interactions: per-project collapse (slide up/down)
// and right-click → delete with inline confirm.
test("sidebar: collapse hides sessions, right-click delete removes one", async ({ page }) => {
  await page.goto("/")
  const { short } = await dispatchDirect()

  const row = page.locator(`[data-testid="sidebar-session"][data-short="${short}"]`)
  await expect(row).toBeVisible({ timeout: 20_000 })

  // Pagination kicks in above SESSION_PAGE_SIZE (5) sessions — with a single
  // session there must be no "Show N more" button.
  await expect(page.getByTestId("sidebar-session-more")).toHaveCount(0)

  // The session list and its header toggle share a bucket key.
  const list = page.locator('[data-testid="sidebar-session-list"]', { has: row })
  const bucketKey = await list.getAttribute("data-bucket-key")
  if (!bucketKey) throw new Error("session list missing data-bucket-key")
  const toggle = page.locator(
    `[data-testid="sidebar-collapse-toggle"][data-bucket-key="${bucketKey}"]`,
  )

  // Collapse: sessions slide away and become hidden.
  await toggle.click()
  await expect(toggle).toHaveAttribute("data-collapsed", "true")
  await expect(row).not.toBeVisible()

  // Expand: sessions slide back.
  await toggle.click()
  await expect(toggle).toHaveAttribute("data-collapsed", "false")
  await expect(row).toBeVisible()

  // Right-click opens the context menu; Escape closes it without deleting.
  await row.click({ button: "right" })
  const menu = page.getByTestId("session-context-menu")
  await expect(menu).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(menu).toHaveCount(0)
  await expect(row).toBeVisible()

  // Right-click → Delete is two-stage: first click arms the confirm,
  // second click removes the session from the sidebar.
  await row.click({ button: "right" })
  const deleteItem = page.getByTestId("session-context-delete")
  await deleteItem.click()
  await expect(deleteItem).toHaveText(/Confirm/i)
  await deleteItem.click()
  await expect(row).toHaveCount(0, { timeout: 30_000 })
})
