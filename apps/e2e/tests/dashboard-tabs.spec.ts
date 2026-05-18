import { expect, test } from "@playwright/test"

// Dashboard root (the "/" route) mirrors the project dashboard layout —
// content is organized as tabs. Default tab is Projects; the Terminal tab
// hosts a WebSocket-backed xterm bound to zellij session "default".
test("dashboard root exposes Projects / Terminal tabs", async ({ page }) => {
  await page.goto("/")
  await expect(page.getByTestId("dashboard")).toBeVisible({ timeout: 15_000 })

  const projectsTab = page.getByTestId("dashboard-tab-projects")
  const terminalTab = page.getByTestId("dashboard-tab-terminal")
  await expect(projectsTab).toBeVisible()
  await expect(terminalTab).toBeVisible()

  // Default tab is Projects.
  await expect(projectsTab).toHaveAttribute("data-active", "true")
  await expect(page.getByTestId("dashboard-tab-panel-projects")).toBeVisible()
  await expect(page.getByTestId("global-terminal")).toBeHidden()

  // Switch to Terminal — global-terminal becomes visible.
  await terminalTab.click()
  await expect(terminalTab).toHaveAttribute("data-active", "true")
  await expect(page.getByTestId("global-terminal")).toBeVisible()
  await expect(page.getByTestId("dashboard-tab-panel-projects")).toBeHidden()

  // Back to Projects.
  await projectsTab.click()
  await expect(projectsTab).toHaveAttribute("data-active", "true")
  await expect(page.getByTestId("dashboard-tab-panel-projects")).toBeVisible()
  await expect(page.getByTestId("global-terminal")).toBeHidden()
})

test("dashboard terminal tab opens a ws to /terminal/global", async ({ page }) => {
  const wsUrls: string[] = []
  page.on("websocket", (ws) => {
    wsUrls.push(ws.url())
  })

  await page.goto("/")
  await expect(page.getByTestId("dashboard")).toBeVisible({ timeout: 15_000 })
  await page.getByTestId("dashboard-tab-terminal").click()
  await expect(page.getByTestId("global-terminal")).toBeVisible()

  await expect
    .poll(() => wsUrls.some((u) => /\/terminal\/global(\?|$)/.test(u)), { timeout: 10_000 })
    .toBe(true)
})
