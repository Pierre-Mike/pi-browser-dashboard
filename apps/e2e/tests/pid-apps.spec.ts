import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { expect, test } from "@playwright/test"
import { ensureProject } from "./helpers"

// Phase 6 — end-to-end pid-apps. HTML dropped into a project's <project>/.pid/
// surfaces as a sandboxed, project-scoped tab. global-setup runs the real daemon
// + web; ensureProject seeds the project dir and we drop the .pid/ tree here so
// discovery is exercised against a real filesystem.
const DAEMON_PORT = process.env.PID_E2E_DAEMON_PORT ?? 18787

const seedPidApps = (): string => {
  const path = ensureProject("pid-demo")
  mkdirSync(join(path, ".pid", "plan"), { recursive: true })
  writeFileSync(
    join(path, ".pid", "index.html"),
    "<!doctype html><meta charset='utf-8'><h1 data-testid='pidapp-default'>PID DEFAULT APP</h1>",
  )
  writeFileSync(
    join(path, ".pid", "plan", "index.html"),
    "<!doctype html><meta charset='utf-8'><h1 data-testid='pidapp-plan'>PID PLAN APP</h1>",
  )
  // A reserved pid internal that must never be served through the default app.
  writeFileSync(join(path, ".pid", "settings.json"), JSON.stringify({ secret: "nope" }))
  return path
}

test("pid-app: dropped HTML lists as a sub-tab under Specs and loads in a sandboxed iframe", async ({
  page,
}) => {
  seedPidApps()
  await page.goto("/projects/pid-demo")
  await expect(page.getByTestId("project-dashboard")).toBeVisible({ timeout: 15_000 })

  // Every pid-app lives under the single parent "Specs" tab, not its own dock
  // tab. Opening Specs selects the first app (the bare-root default) by default.
  const specsTab = page.getByTestId("project-tab-pidapps")
  await expect(specsTab).toBeVisible({ timeout: 15_000 })
  await specsTab.click()

  // Both dropped apps appear as left-rail sub-tabs.
  await expect(page.getByTestId("pidapp-subtab-default")).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId("pidapp-subtab-plan")).toBeVisible()

  // The default app's sandboxed iframe renders the dropped HTML.
  await expect(page.getByTestId("project-tab-panel-pidapp-default")).toBeVisible()
  const defaultFrame = page.frameLocator('[data-testid="pid-app-host-default"]')
  await expect(defaultFrame.getByTestId("pidapp-default")).toContainText("PID DEFAULT APP", {
    timeout: 15_000,
  })

  // Selecting another sub-tab swaps the hosted app without leaving the Specs tab.
  await page.getByTestId("pidapp-subtab-plan").click()
  await expect(page.getByTestId("project-tab-panel-pidapp-plan")).toBeVisible()
  const planFrame = page.frameLocator('[data-testid="pid-app-host-plan"]')
  await expect(planFrame.getByTestId("pidapp-plan")).toContainText("PID PLAN APP", {
    timeout: 15_000,
  })
})

test("daemon pid-apps route lists the apps and rejects reserved + traversal access", async ({
  request,
}) => {
  seedPidApps()
  const daemonUrl = `http://localhost:${DAEMON_PORT}`

  const list = await request.get(`${daemonUrl}/projects/pid-demo/pid-apps`)
  expect(list.ok()).toBeTruthy()
  const body = (await list.json()) as Array<{ id: string }>
  expect(body.map((a) => a.id).sort()).toEqual(["default", "plan"])

  // The default app's root is the whole .pid dir, so reserved internals must be
  // refused even though they physically sit beside index.html.
  const reserved = await request.get(
    `${daemonUrl}/projects/pid-demo/pid-apps/default/settings.json`,
  )
  expect([403, 404]).toContain(reserved.status())

  // Single- and double-encoded traversal are rejected before the filesystem.
  const traverse = await request.get(
    `${daemonUrl}/projects/pid-demo/pid-apps/default/..%2f..%2fsettings.json`,
  )
  expect([400, 404]).toContain(traverse.status())
  const traverseDouble = await request.get(
    `${daemonUrl}/projects/pid-demo/pid-apps/default/..%252f..%252fsettings.json`,
  )
  expect([400, 404]).toContain(traverseDouble.status())
})
