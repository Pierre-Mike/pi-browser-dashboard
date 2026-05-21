import { expect, test } from "@playwright/test"
import { ensureProject } from "./helpers"

test("dashboard terminal has no redundant 'Terminal / zellij · default' header", async ({
  page,
}) => {
  await page.goto("/")
  await expect(page.getByTestId("dashboard")).toBeVisible({ timeout: 15_000 })
  await page.getByTestId("dashboard-tab-terminal").click()
  const term = page.getByTestId("global-terminal")
  await expect(term).toBeVisible()
  await expect(term.getByRole("heading", { name: "Terminal" })).toHaveCount(0)
  await expect(term.getByText("zellij · default")).toHaveCount(0)
})

test("project terminal has no redundant 'Terminal / zellij · <name>' header", async ({ page }) => {
  ensureProject("proj-terminal-header", { gitInit: true })
  await page.goto("/projects/proj-terminal-header")
  await expect(page.getByTestId("project-dashboard")).toBeVisible({ timeout: 15_000 })
  await page.getByTestId("project-tab-terminal").click()
  const term = page.getByTestId("project-terminal")
  await expect(term).toBeVisible()
  await expect(term.getByRole("heading", { name: "Terminal" })).toHaveCount(0)
  await expect(term.getByText(/zellij · /)).toHaveCount(0)
})
