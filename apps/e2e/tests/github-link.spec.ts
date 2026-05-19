import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { expect, test } from "@playwright/test"
import { ensureProject } from "./helpers"

// Dashboard surfaces a GitHub link when the project has a github.com origin
// in its .git/config, and hides it when it doesn't.
test("project dashboard exposes GitHub link from origin remote", async ({ page }) => {
  const projectPath = ensureProject("proj-github-link", { gitInit: true })
  writeFileSync(
    join(projectPath, ".git", "config"),
    `[core]
\trepositoryformatversion = 0
[remote "origin"]
\turl = git@github.com:Pierre-Mike/pi-browser-dashboard.git
\tfetch = +refs/heads/*:refs/remotes/origin/*
`,
  )

  await page.goto("/projects/proj-github-link")
  await expect(page.locator('[data-testid="project-dashboard"]')).toBeVisible({ timeout: 15_000 })

  const link = page.getByTestId("github-link")
  await expect(link).toBeVisible()
  await expect(link).toHaveAttribute("href", "https://github.com/Pierre-Mike/pi-browser-dashboard")
  await expect(link).toHaveAttribute("target", "_blank")

  // GitHub panel sits under the GitHub tab — switch to it before asserting.
  await page.getByTestId("project-tab-github").click()
  await expect(page.getByTestId("github-panel")).toBeVisible()
})

test("project dashboard hides GitHub link when no github origin", async ({ page }) => {
  ensureProject("proj-no-github", { gitInit: true })
  // No .git/config written → no origin remote → no GitHub link.

  await page.goto("/projects/proj-no-github")
  await expect(page.locator('[data-testid="project-dashboard"]')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId("github-link")).toHaveCount(0)
  await expect(page.getByTestId("github-panel")).toHaveCount(0)
  await expect(page.getByTestId("project-tab-github")).toHaveCount(0)
})
