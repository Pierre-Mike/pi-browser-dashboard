import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { expect, test } from "@playwright/test"
import {
  cardLocator,
  dispatchDirect,
  ensureProject,
  rmSession,
  waitForCard,
  waitForSessionInRegistry,
} from "./helpers"

// Project dashboard sections (Sessions / GitHub / Terminal / Files) are
// organized as tabs. Only the active tab's content is visible; switching
// tabs reveals the other panels.
test("project dashboard exposes Sessions / GitHub / Terminal / Files tabs", async ({ page }) => {
  const projectPath = ensureProject("proj-tabs", { gitInit: true })
  writeFileSync(
    join(projectPath, ".git", "config"),
    `[core]
\trepositoryformatversion = 0
[remote "origin"]
\turl = git@github.com:Pierre-Mike/pi-browser-dashboard.git
\tfetch = +refs/heads/*:refs/remotes/origin/*
`,
  )

  const { short } = await dispatchDirect(undefined, { cwd: projectPath })
  await waitForSessionInRegistry(short)

  try {
    await page.goto("/projects/proj-tabs")
    await expect(page.locator('[data-testid="project-dashboard"]')).toBeVisible({ timeout: 15_000 })

    // All four tab triggers are present (GitHub appears because origin is set).
    const sessionsTab = page.getByTestId("project-tab-sessions")
    const githubTab = page.getByTestId("project-tab-github")
    const terminalTab = page.getByTestId("project-tab-terminal")
    const filesTab = page.getByTestId("project-tab-files")
    await expect(sessionsTab).toBeVisible()
    await expect(githubTab).toBeVisible()
    await expect(terminalTab).toBeVisible()
    await expect(filesTab).toBeVisible()

    // Default tab is Terminal — the terminal host is visible, other panels hidden.
    await expect(terminalTab).toHaveAttribute("data-active", "true")
    await expect(page.getByTestId("project-terminal")).toBeVisible()
    await expect(page.getByTestId("github-panel")).toBeHidden()
    await expect(page.getByTestId("project-file-tree")).toBeHidden()

    // Switch to Sessions.
    await sessionsTab.click()
    await expect(sessionsTab).toHaveAttribute("data-active", "true")
    await waitForCard(page, short, 20_000)
    await expect(cardLocator(page, short)).toBeVisible()
    await expect(page.getByTestId("project-terminal")).toBeHidden()

    // Switch to GitHub.
    await githubTab.click()
    await expect(githubTab).toHaveAttribute("data-active", "true")
    await expect(page.getByTestId("github-panel")).toBeVisible()
    await expect(cardLocator(page, short)).toBeHidden()

    // Switch to Files.
    await filesTab.click()
    await expect(filesTab).toHaveAttribute("data-active", "true")
    await expect(page.getByTestId("project-file-tree")).toBeVisible()
    await expect(page.getByTestId("github-panel")).toBeHidden()

    // Back to Terminal.
    await terminalTab.click()
    await expect(terminalTab).toHaveAttribute("data-active", "true")
    await expect(page.getByTestId("project-terminal")).toBeVisible()
    await expect(page.getByTestId("project-file-tree")).toBeHidden()
  } finally {
    rmSession(short)
  }
})

test("Files tab fills viewport height and the tree list scrolls within it", async ({ page }) => {
  ensureProject("proj-files-fill", { gitInit: true })

  await page.goto("/projects/proj-files-fill")
  await expect(page.locator('[data-testid="project-dashboard"]')).toBeVisible({ timeout: 15_000 })

  await page.getByTestId("project-tab-files").click()
  const tree = page.getByTestId("project-file-tree")
  await expect(tree).toBeVisible()

  // The file tree should fill close to the full viewport — not be capped at the
  // previous 70vh fixed cell.
  const viewport = page.viewportSize()
  if (!viewport) throw new Error("viewport size unavailable")
  const treeBox = await tree.boundingBox()
  if (!treeBox) throw new Error("tree bounding box unavailable")
  expect(treeBox.height).toBeGreaterThanOrEqual(viewport.height * 0.8)

  // The inner tree-row container must be scrollable so long file lists don't
  // overflow the panel.
  const scroller = page.getByTestId("file-tree-scroll")
  await expect(scroller).toBeVisible()
  const scrollOverflow = await scroller.evaluate((el) => getComputedStyle(el).overflowY)
  expect(scrollOverflow).toBe("auto")
})

test("project dashboard hides GitHub tab when no github origin", async ({ page }) => {
  ensureProject("proj-tabs-no-gh", { gitInit: true })

  await page.goto("/projects/proj-tabs-no-gh")
  await expect(page.locator('[data-testid="project-dashboard"]')).toBeVisible({ timeout: 15_000 })

  await expect(page.getByTestId("project-tab-sessions")).toBeVisible()
  await expect(page.getByTestId("project-tab-terminal")).toBeVisible()
  await expect(page.getByTestId("project-tab-files")).toBeVisible()
  await expect(page.getByTestId("project-tab-github")).toHaveCount(0)
})
