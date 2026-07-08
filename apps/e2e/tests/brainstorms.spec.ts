import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { expect, test } from "@playwright/test"
import { ensureProject } from "./helpers"

// End-to-end brainstorms: named canvas documents under <project>/.pid/brainstorms/
// surface as left-rail boards on the project's Brainstorm tab, the shared canvas
// editor binds to the selected document over the brainstorm ws route, and the
// AI-companion panel offers its role actions. global-setup runs the real daemon
// + web; we seed a document on disk so discovery runs against a real filesystem.
const DAEMON_PORT = process.env.PID_E2E_DAEMON_PORT ?? 18787

const seedBrainstorm = (): string => {
  const path = ensureProject("brainstorm-demo")
  const dir = join(path, ".pid", "brainstorms")
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, "seeded-board.canvas.json"),
    JSON.stringify({
      version: 1,
      updatedAt: "2026-01-01T00:00:00.000Z",
      nodes: [{ id: "n1", position: { x: 40, y: 40 }, data: { label: "seeded idea" } }],
      edges: [],
    }),
  )
  return path
}

test("brainstorm: seeded board lists in the left rail, binds the live canvas, and shows AI companions", async ({
  page,
}) => {
  seedBrainstorm()
  await page.goto("/projects/brainstorm-demo")
  await expect(page.getByTestId("project-dashboard")).toBeVisible({ timeout: 15_000 })

  // Boards live under the single parent "Brainstorm" tab, not their own dock tabs.
  const brainstormTab = page.getByTestId("project-tab-brainstorm")
  await expect(brainstormTab).toBeVisible({ timeout: 15_000 })
  await brainstormTab.click()
  await expect(brainstormTab).toHaveAttribute("data-active", "true")

  // The seeded document appears as a left-rail sub-tab and is auto-selected.
  await expect(page.getByTestId("brainstorm-subtab-seeded-board")).toBeVisible({
    timeout: 15_000,
  })
  await expect(page.getByTestId("project-tab-panel-brainstorm-seeded-board")).toBeVisible()

  // The shared canvas editor binds to the document over the brainstorm ws
  // route: the sync badge reaching "live" proves the whole WS path end-to-end.
  await expect(page.getByTestId("canvas-tab")).toBeVisible()
  await expect(page.getByTestId("canvas-status")).toHaveText("live", { timeout: 15_000 })

  // The seeded node made it from disk onto the canvas.
  await expect(page.getByText("seeded idea")).toBeVisible({ timeout: 15_000 })

  // The AI companion panel offers the role actions (no live spawn in e2e).
  await expect(page.getByTestId("brainstorm-companion")).toBeVisible()
  for (const role of ["review", "beautify", "critique", "ideate"]) {
    await expect(page.getByTestId(`brainstorm-role-${role}`)).toBeVisible()
  }

  // The session-canvas-only "Brief AI" button must NOT leak into brainstorm mode.
  await expect(page.getByTestId("canvas-brief-ai")).toHaveCount(0)
})

test("brainstorm: the + button creates a board and switches to it", async ({ page }) => {
  seedBrainstorm()
  await page.goto("/projects/brainstorm-demo?tab=brainstorm")
  await expect(page.getByTestId("brainstorm-subtabs")).toBeVisible({ timeout: 15_000 })

  await page.getByTestId("brainstorm-new").click()
  await page.getByTestId("brainstorm-new-input").fill("fresh-board")
  await page.getByTestId("brainstorm-new-input").press("Enter")

  await expect(page.getByTestId("brainstorm-subtab-fresh-board")).toBeVisible({
    timeout: 15_000,
  })
  await expect(page.getByTestId("brainstorm-subtab-fresh-board")).toHaveAttribute(
    "data-active",
    "true",
  )
  await expect(page.getByTestId("canvas-status")).toHaveText("live", { timeout: 15_000 })
})

test("daemon brainstorms routes list/create documents and reject bad names + traversal", async ({
  request,
}) => {
  seedBrainstorm()
  const daemonUrl = `http://localhost:${DAEMON_PORT}`

  const list = await request.get(`${daemonUrl}/projects/brainstorm-demo/brainstorms`)
  expect(list.ok()).toBeTruthy()
  const body = (await list.json()) as Array<{ id: string; file: string }>
  expect(body.map((b) => b.id)).toContain("seeded-board")

  const created = await request.post(`${daemonUrl}/projects/brainstorm-demo/brainstorms`, {
    data: { name: "api-made" },
  })
  expect(created.status()).toBe(201)

  const dupe = await request.post(`${daemonUrl}/projects/brainstorm-demo/brainstorms`, {
    data: { name: "api-made" },
  })
  expect(dupe.status()).toBe(409)

  const badName = await request.post(`${daemonUrl}/projects/brainstorm-demo/brainstorms`, {
    data: { name: "../escape" },
  })
  expect(badName.status()).toBe(400)

  const traversal = await request.get(
    `${daemonUrl}/projects/brainstorm-demo/brainstorms/..%2fsecrets`,
  )
  expect([400, 404]).toContain(traversal.status())
})
