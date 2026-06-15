import { expect, test } from "@playwright/test"
import { dispatchDirect, rmSession, waitForSessionInRegistry } from "./helpers"

// The top-of-sidebar "+ New session" entry point spawns a session that isn't
// tied to a project — for ad-hoc questions or a brand-new repo. Such sessions
// land in a single "Default" bucket pinned to the top of the sidebar.

test("'+ New session' opens the spawn modal with no project", async ({ page }) => {
  await page.goto("/")

  const newSession = page.getByTestId("sidebar-new-session")
  await expect(newSession).toBeVisible({ timeout: 15_000 })
  await newSession.click()

  const modal = page.getByTestId("spawn-modal")
  await expect(modal).toBeVisible()
  // A project-less spawn names "no project" in the header.
  await expect(modal.getByText("no project")).toBeVisible()

  await modal.getByRole("button", { name: "Cancel" }).click()
  await expect(modal).toHaveCount(0)
})

test("a session with no matching project lands in the Default bucket", async ({ page }) => {
  // Default cwd is the workspace root, which is not itself a project — so the
  // session has no project to attach to and belongs under Default.
  const { short } = await dispatchDirect()
  await waitForSessionInRegistry(short)

  try {
    await page.goto("/")
    const row = page.locator(`[data-testid="sidebar-session"][data-short="${short}"]`)
    await expect(row).toBeVisible({ timeout: 20_000 })

    const list = page.locator('[data-testid="sidebar-session-list"]', { has: row })
    await expect(list).toHaveAttribute("data-bucket-key", "default")
    await expect(page.getByTestId("sidebar-default-title")).toBeVisible()
  } finally {
    rmSession(short)
  }
})
