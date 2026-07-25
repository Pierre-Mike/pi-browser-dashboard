import { expect, test } from "@playwright/test"

// Collapsing the desktop sidebar used to leave a slim w-12 rail behind. It
// must now vanish completely — no rail chrome at all — replaced by one small
// floating button that restores it.
test("collapsing the desktop sidebar removes it entirely; the floating button restores it", async ({
  page,
}) => {
  await page.goto("/")

  const sidebar = page.getByTestId("sidebar")
  await expect(sidebar).toBeVisible({ timeout: 15_000 })
  const openBtn = page.getByTestId("sidebar-rail-open")
  await expect(openBtn).toHaveCount(0)

  await page.getByTestId("sidebar-rail-toggle").click()

  // Fully gone — not just visually hidden.
  await expect(sidebar).not.toBeAttached()
  await expect(openBtn).toBeVisible()

  await openBtn.click()

  await expect(page.getByTestId("sidebar")).toBeVisible()
  await expect(openBtn).toHaveCount(0)
})
