import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { expect, test } from "@playwright/test"
import { ensureProject } from "./helpers"

// The file viewer shows a Download button on top of every previewed file, and
// the download keeps the file's original name (the daemon sets
// Content-Disposition: attachment with the basename).
test("file viewer offers a download that preserves the filename", async ({ page }) => {
  const projectPath = ensureProject("proj-download", { gitInit: true })
  writeFileSync(join(projectPath, "report.txt"), "hello download\n")

  await page.goto("/projects/proj-download")
  await expect(page.locator('[data-testid="project-dashboard"]')).toBeVisible({ timeout: 15_000 })

  await page.getByTestId("project-tab-files").click()
  await expect(page.getByTestId("project-file-tree")).toBeVisible()

  // The tree (@pierre/trees) renders rows as ARIA treeitems in an open shadow
  // root; Playwright pierces it and matches on the accessible name. The tree
  // opens expanded, so a root-level file is visible without drilling in.
  const fileRow = page.getByTestId("project-file-tree").getByRole("treeitem", {
    name: "report.txt",
  })
  await expect(fileRow).toBeVisible()
  await fileRow.click()
  await expect(page.getByTestId("file-preview")).toBeVisible()

  // The download control sits in the preview toolbar and carries the basename.
  const download = page.getByTestId("file-download")
  await expect(download).toBeVisible()
  await expect(download).toHaveAttribute("download", "report.txt")

  // Clicking it actually downloads under the original name.
  const [dl] = await Promise.all([page.waitForEvent("download"), download.click()])
  expect(dl.suggestedFilename()).toBe("report.txt")
})
