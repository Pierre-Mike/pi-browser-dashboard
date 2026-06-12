import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { expect, test } from "@playwright/test"
import { ensureProject } from "./helpers"

// GFM table column alignment (`:-:`, `--:`) must survive into the rendered
// table — the MarkdownView th/td read node.properties.align and apply the
// matching Tailwind class rather than collapsing every cell to left.
test("markdown view applies GFM table column alignment", async ({ page }) => {
  const projectPath = ensureProject("proj-md-align")
  writeFileSync(
    join(projectPath, "table.md"),
    ["| L | C | R |", "|:--|:-:|--:|", "| a | b | c |", ""].join("\n"),
  )

  await page.goto("/projects/proj-md-align")
  await expect(page.locator('[data-testid="project-dashboard"]')).toBeVisible({ timeout: 15_000 })

  await page.getByTestId("project-tab-files").click()
  await expect(page.getByTestId("project-file-tree")).toBeVisible()

  await page.getByTestId("project-file-tree").getByRole("treeitem", { name: "table.md" }).click()
  const md = page.getByTestId("markdown-rendered")
  await expect(md).toBeVisible()

  // Header cells carry the per-column alignment: left, center, right.
  await expect(md.locator("th.text-left")).toHaveText("L")
  await expect(md.locator("th.text-center")).toHaveText("C")
  await expect(md.locator("th.text-right")).toHaveText("R")
  // And body cells follow their column.
  await expect(md.locator("td.text-center")).toHaveText("b")
})
