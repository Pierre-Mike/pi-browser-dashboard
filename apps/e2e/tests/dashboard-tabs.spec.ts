import { expect, test } from "@playwright/test"

// Dashboard root (the "/" route) mirrors the project dashboard layout —
// content is organized as tabs. Default tab is Terminal, which hosts a
// WebSocket-backed xterm bound to zellij session "default".
test("dashboard root exposes Projects / Terminal tabs", async ({ page }) => {
  await page.goto("/")
  await expect(page.getByTestId("dashboard")).toBeVisible({ timeout: 15_000 })

  const projectsTab = page.getByTestId("dashboard-tab-projects")
  const terminalTab = page.getByTestId("dashboard-tab-terminal")
  await expect(projectsTab).toBeVisible()
  await expect(terminalTab).toBeVisible()

  // Default tab is Terminal.
  await expect(terminalTab).toHaveAttribute("data-active", "true")
  await expect(page.getByTestId("global-terminal")).toBeVisible()
  await expect(page.getByTestId("dashboard-tab-panel-projects")).toBeHidden()

  // Switch to Projects.
  await projectsTab.click()
  await expect(projectsTab).toHaveAttribute("data-active", "true")
  await expect(page.getByTestId("dashboard-tab-panel-projects")).toBeVisible()
  await expect(page.getByTestId("global-terminal")).toBeHidden()

  // Back to Terminal.
  await terminalTab.click()
  await expect(terminalTab).toHaveAttribute("data-active", "true")
  await expect(page.getByTestId("global-terminal")).toBeVisible()
  await expect(page.getByTestId("dashboard-tab-panel-projects")).toBeHidden()
})

// The Orchestration tab is global — one voice supervisor for all projects —
// so it lives on the root dashboard. Selecting it shows its terminal host.
test("dashboard exposes a global Orchestration tab with its own terminal", async ({ page }) => {
  await page.goto("/")
  await expect(page.getByTestId("dashboard")).toBeVisible({ timeout: 15_000 })

  const orchestrationTab = page.getByTestId("dashboard-tab-orchestration")
  await expect(orchestrationTab).toBeVisible()

  // Default is Terminal — orchestration panel hidden (and unmounted) until picked.
  await expect(page.getByTestId("orchestration-terminal")).toBeHidden()

  await orchestrationTab.click()
  await expect(orchestrationTab).toHaveAttribute("data-active", "true")
  await expect(page.getByTestId("orchestration-terminal")).toBeVisible()
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

// Regression: the daemon seals the zellij pty size at spawn time from the
// cols/rows query params. FitAddon used to be read synchronously right after
// term.open(), before xterm measured a char cell — handing the daemon 80×24
// and stranding the zellij session there. The fix defers WS open until fit
// resolves.
test("global terminal handshake passes fit-resolved cols/rows, not 80x24", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 })
  const wsUrls: string[] = []
  page.on("websocket", (ws) => {
    wsUrls.push(ws.url())
  })

  await page.goto("/")
  await expect(page.getByTestId("dashboard")).toBeVisible({ timeout: 15_000 })
  await page.getByTestId("dashboard-tab-terminal").click()
  await expect(page.getByTestId("global-terminal")).toBeVisible()

  await expect
    .poll(() => wsUrls.find((u) => /\/terminal\/global\?/.test(u)) ?? null, { timeout: 10_000 })
    .not.toBeNull()

  const url = new URL(wsUrls.find((u) => /\/terminal\/global\?/.test(u)) as string)
  const cols = Number(url.searchParams.get("cols"))
  const rows = Number(url.searchParams.get("rows"))
  expect(cols).toBeGreaterThan(80)
  expect(rows).toBeGreaterThan(24)
})

// The Settings tab manages the global settings file
// (<claudeConfigDir>/pid-dashboard/settings.json). Selecting it shows the
// global-settings panel with the git default-branch field seeded from the
// daemon's defaults.
test("dashboard exposes a global Settings tab managing the settings file", async ({ page }) => {
  await page.goto("/")
  await expect(page.getByTestId("dashboard")).toBeVisible({ timeout: 15_000 })

  const settingsTab = page.getByTestId("dashboard-tab-settings")
  await expect(settingsTab).toBeVisible()
  await expect(page.getByTestId("dashboard-tab-panel-settings")).toBeHidden()

  await settingsTab.click()
  await expect(settingsTab).toHaveAttribute("data-active", "true")
  await expect(page.getByTestId("global-settings-panel")).toBeVisible()
  await expect(page.getByTestId("gs-git-defaultBranch")).toBeVisible()
})
