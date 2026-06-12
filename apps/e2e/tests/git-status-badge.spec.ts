import { spawnSync } from "node:child_process"
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { expect, test } from "@playwright/test"
import { ensureProject } from "./helpers"

// git spawns must not inherit an ambient GIT_DIR/GIT_WORK_TREE (the e2e run may
// itself sit inside a git hook), or the commands would target the real repo
// instead of the fixture. Mirror the daemon's cleanGitEnv scrub.
const gitEnv = (): NodeJS.ProcessEnv =>
  Object.fromEntries(
    Object.entries(process.env).filter(([k, v]) => v !== undefined && !k.startsWith("GIT_")),
  )

const git = (cwd: string, ...args: string[]): void => {
  const res = spawnSync("git", args, { cwd, env: gitEnv(), encoding: "utf8" })
  if (res.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${res.stderr}`)
}

// The file tree carries @pierre/trees git-status badges: the daemon overlays
// `git status` onto the listing and each dirty row gets a `data-item-git-status`
// attribute. A tracked file edited in the worktree should read "modified".
test("file tree badges a modified file with its git status", async ({ page }) => {
  const projectPath = ensureProject("proj-git-badge")
  const file = join(projectPath, "tracked.ts")
  writeFileSync(file, "export const v = 1\n")

  // Real repo with a committed baseline, then dirty the tracked file so
  // `git status` reports ` M tracked.ts`.
  git(projectPath, "init", "-q")
  git(projectPath, "-c", "user.name=Test", "-c", "user.email=test@example.com", "add", ".")
  git(
    projectPath,
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.com",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-q",
    "-m",
    "baseline",
  )
  writeFileSync(file, "export const v = 2\n")

  await page.goto("/projects/proj-git-badge")
  await expect(page.locator('[data-testid="project-dashboard"]')).toBeVisible({ timeout: 15_000 })

  await page.getByTestId("project-tab-files").click()
  await expect(page.getByTestId("project-file-tree")).toBeVisible()

  // @pierre/trees rows are ARIA treeitems in an open shadow root; Playwright
  // pierces it and matches on the accessible name. The dirty row carries the
  // mapped status on `data-item-git-status`.
  const fileRow = page.getByTestId("project-file-tree").getByRole("treeitem", {
    name: "tracked.ts",
  })
  await expect(fileRow).toBeVisible()
  await expect(fileRow).toHaveAttribute("data-item-git-status", "modified")
})
