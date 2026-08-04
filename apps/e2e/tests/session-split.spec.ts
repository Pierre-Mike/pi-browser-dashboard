import { expect, test } from "@playwright/test"
import { openSessionPage, rmSession, spawnSettled } from "./helpers"

// The drill-in is a split: the terminal is the surface and every section docks
// beside it. These assertions are the contract that replaced "Terminal is one of
// four tabs" — in particular that no click can take the terminal off screen, and
// that toggling a pane does not REMOUNT it (a remount drops the pty attach and
// costs the visible scrollback).

test("session split: terminal is always on, sections dock beside it and toggle off", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.goto("/")
  const short = await spawnSettled(page)
  try {
    await openSessionPage(page, short)

    const terminal = page.getByTestId("session-terminal-pane")
    const pane = page.getByTestId("session-side-pane")

    // Opens on the terminal alone, at full width.
    await expect(terminal).toBeVisible()
    await expect(pane).toHaveCount(0)
    const fullWidth = await terminal.evaluate((el) => el.getBoundingClientRect().width)

    // Mark the live xterm host so a remount is detectable: a fresh element would
    // not carry this property.
    await expect(page.getByTestId("terminal-host")).toBeVisible({ timeout: 20_000 })
    await page.getByTestId("terminal-host").evaluate((el) => {
      ;(el as HTMLElement & { __pidMark?: string }).__pidMark = "kept"
    })

    // Files docks to the RIGHT and the terminal keeps a (narrower) column.
    await page.getByTestId("tab-files").click()
    await expect(pane).toBeVisible()
    await expect(terminal).toBeVisible()
    const split = await page.evaluate(() => {
      const rect = (sel: string) =>
        document.querySelector(sel)?.getBoundingClientRect() ?? new DOMRect()
      return {
        terminal: rect('[data-testid="session-terminal-pane"]'),
        pane: rect('[data-testid="session-side-pane"]'),
      }
    })
    expect(split.pane.left).toBeGreaterThanOrEqual(split.terminal.right - 1)
    expect(split.terminal.width).toBeLessThan(fullWidth)
    expect(split.terminal.width).toBeGreaterThan(200)

    // Switching sections keeps the SAME terminal element mounted.
    await page.getByTestId("tab-brainstorm").click()
    await expect(page.getByTestId("tab-brainstorm")).toHaveAttribute("data-active", "true")
    await expect(terminal).toBeVisible()

    // Clicking the lit section closes the pane and the terminal takes the row
    // back — still the same element it started as.
    await page.getByTestId("tab-brainstorm").click()
    await expect(pane).toHaveCount(0)
    await expect(terminal).toBeVisible()
    await expect
      .poll(() => terminal.evaluate((el) => el.getBoundingClientRect().width))
      .toBeGreaterThan(split.terminal.width)

    const mark = await page
      .getByTestId("terminal-host")
      .evaluate((el) => (el as HTMLElement & { __pidMark?: string }).__pidMark)
    expect(mark).toBe("kept")
  } finally {
    rmSession(short)
  }
})

test("session split: ?tab=terminal deep links still land on a closed pane", async ({ page }) => {
  await page.goto("/")
  const short = await spawnSettled(page)
  try {
    // Minted before the split existed; it now means "terminal only", which is
    // what it always showed.
    await page.goto(`/sessions/${short}?tab=terminal`)
    await expect(page.getByTestId("session-terminal-pane")).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId("session-side-pane")).toHaveCount(0)
    await expect(page.getByTestId("tab-files")).toHaveAttribute("data-active", "false")
  } finally {
    rmSession(short)
  }
})
