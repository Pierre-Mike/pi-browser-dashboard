import { expect, test } from "@playwright/test"
import { ensureProject } from "./helpers"

// Regression: dashboard and project terminals used a hardcoded
// `h-[calc(100vh-Xrem)]` that under-counted chrome above them, capping the
// xterm host well short of the available area. The fix makes the page a
// flex column with viewport height so the terminal grows via flex-1.

test("dashboard terminal fills available space below tab nav", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.goto("/")
  await expect(page.getByTestId("dashboard")).toBeVisible({ timeout: 15_000 })
  await page.getByTestId("dashboard-tab-terminal").click()
  await expect(page.getByTestId("global-terminal")).toBeVisible()
  await expect(page.locator("[data-testid='terminal-host'] .xterm-screen")).toBeVisible({
    timeout: 15_000,
  })

  const m = await page.evaluate(() => {
    const host = document.querySelector('[data-testid="terminal-host"]') as HTMLElement | null
    const tab = document.querySelector(
      '[data-testid="dashboard-tab-panel-terminal"]',
    ) as HTMLElement | null
    const screen = host?.querySelector(".xterm-screen") as HTMLElement | null
    return {
      hostHeight: host?.clientHeight ?? 0,
      hostBottom: host?.getBoundingClientRect().bottom ?? 0,
      tabBottom: tab?.getBoundingClientRect().bottom ?? 0,
      screenHeight: screen?.getBoundingClientRect().height ?? 0,
      viewportHeight: window.innerHeight,
    }
  })

  // Host must consume most of the viewport below the header + tab nav.
  // Old behaviour: ~712px (100vh - 18rem). New: should approach ~880px+.
  expect(m.hostHeight).toBeGreaterThan(800)
  // Screen should occupy most of the host.
  expect(m.screenHeight).toBeGreaterThan(m.hostHeight * 0.7)
  // Terminal tab panel reaches the viewport bottom (allow slack for status row).
  expect(m.viewportHeight - m.tabBottom).toBeLessThan(8)
})

test("project terminal fills available space below project chrome", async ({ page }) => {
  ensureProject("proj-terminal-fill", { gitInit: true })
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.goto("/projects/proj-terminal-fill")
  await expect(page.getByTestId("project-dashboard")).toBeVisible({ timeout: 15_000 })
  await page.getByTestId("project-tab-terminal").click()
  await expect(page.getByTestId("project-terminal")).toBeVisible()
  await expect(page.locator("[data-testid='terminal-host'] .xterm-screen")).toBeVisible({
    timeout: 15_000,
  })

  const m = await page.evaluate(() => {
    const host = document.querySelector('[data-testid="terminal-host"]') as HTMLElement | null
    const tab = document.querySelector(
      '[data-testid="project-tab-panel-terminal"]',
    ) as HTMLElement | null
    const screen = host?.querySelector(".xterm-screen") as HTMLElement | null
    return {
      hostHeight: host?.clientHeight ?? 0,
      hostBottom: host?.getBoundingClientRect().bottom ?? 0,
      tabBottom: tab?.getBoundingClientRect().bottom ?? 0,
      screenHeight: screen?.getBoundingClientRect().height ?? 0,
      viewportHeight: window.innerHeight,
    }
  })

  // Project page has more chrome than dashboard (header, pills, path), so the
  // bar is lower — but still well above the old 100vh-24rem (=616px) ceiling.
  expect(m.hostHeight).toBeGreaterThan(620)
  expect(m.screenHeight).toBeGreaterThan(m.hostHeight * 0.7)
  expect(m.viewportHeight - m.tabBottom).toBeLessThan(8)
})
