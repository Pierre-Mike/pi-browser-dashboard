import { expect, test } from "@playwright/test"

// The top "pi-browser-dashboard" header was removed; its home link moved
// onto the sidebar's "Projects" header. Guard both — no stray top header,
// sidebar Projects label navigates back to the dashboard root.
test("sidebar Projects header links home and the top header is gone", async ({ page }) => {
  await page.goto("/sessions/does-not-exist")

  const sidebar = page.getByTestId("sidebar")
  await expect(sidebar).toBeVisible()

  // No top header above the sidebar — the sidebar must sit flush with the
  // top of the viewport.
  const sidebarBox = await sidebar.boundingBox()
  if (!sidebarBox) throw new Error("missing sidebar bounding box")
  expect(sidebarBox.y).toBeLessThan(2)

  // The removed header's wordmark must not reappear anywhere on the page.
  await expect(page.getByText("pi-browser-dashboard", { exact: true })).toHaveCount(0)
  await expect(page.getByText("⇧⇧ to jump")).toHaveCount(0)

  // The "Projects" label in the sidebar header is the new home link.
  const projectsLink = page.getByTestId("sidebar-projects-link")
  await expect(projectsLink).toHaveText(/Projects/i)
  await projectsLink.click()
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByTestId("dashboard")).toBeVisible()
})
