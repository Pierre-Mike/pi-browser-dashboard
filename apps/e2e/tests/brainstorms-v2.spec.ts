import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { expect, test } from "@playwright/test"
import { ensureProject } from "./helpers"

// End-to-end Brainstorm V2: native Excalidraw documents under
// <project>/.pid/brainstorms/*.excalidraw surface as boards in the same left
// rail as V1 canvases, the embedded Excalidraw editor binds to the document
// over the excalidraw ws route, and the AI panel is a single plain session
// control — no V1 role buttons. global-setup runs the real daemon + web; we
// seed a document on disk so discovery runs against a real filesystem.
const DAEMON_PORT = process.env.PID_E2E_DAEMON_PORT ?? 18787

// Native format with keys the daemon has no schema for — the routes must
// relay them untouched.
const seededDoc = {
  type: "excalidraw",
  version: 2,
  source: "https://excalidraw.com",
  elements: [
    {
      id: "seed-rect",
      type: "rectangle",
      x: 40,
      y: 40,
      width: 120,
      height: 60,
      customFutureKey: true,
    },
  ],
  appState: { viewBackgroundColor: "#ffffff" },
  files: {},
}

const seedExcalidrawBoard = (): string => {
  const path = ensureProject("excalidraw-demo")
  const dir = join(path, ".pid", "brainstorms")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "seeded-sketch.excalidraw"), JSON.stringify(seededDoc))
  return path
}

test("brainstorm v2: a seeded .excalidraw board lists in the rail, binds the live Excalidraw editor, and offers one plain AI session", async ({
  page,
}) => {
  seedExcalidrawBoard()
  await page.goto("/projects/excalidraw-demo?tab=brainstorm:seeded-sketch")
  await expect(page.getByTestId("project-dashboard")).toBeVisible({ timeout: 15_000 })

  // The board shares the V1 left rail and deep-link scheme.
  await expect(page.getByTestId("brainstorm-subtab-seeded-sketch")).toBeVisible({
    timeout: 15_000,
  })
  await expect(page.getByTestId("brainstorm-subtab-seeded-sketch")).toHaveAttribute(
    "data-active",
    "true",
  )

  // The Excalidraw editor (not the V1 React-Flow canvas) binds to the
  // document: the sync badge reaching "live" proves the excalidraw ws path
  // end-to-end.
  await expect(page.getByTestId("excalidraw-board")).toBeVisible()
  await expect(page.getByTestId("excalidraw-status")).toHaveText("live", { timeout: 15_000 })
  await expect(page.getByTestId("canvas-tab")).toHaveCount(0)

  // Excalidraw itself mounted (it renders its own .excalidraw root).
  await expect(page.locator(".excalidraw").first()).toBeVisible({ timeout: 15_000 })

  // The AI panel is a single plain session — a start control and NO V1 role
  // buttons or mission labels.
  await expect(page.getByTestId("excalidraw-companion")).toBeVisible()
  await expect(page.getByTestId("excalidraw-session-start")).toBeVisible()
  for (const role of ["review", "beautify", "critique", "ideate"]) {
    await expect(page.getByTestId(`brainstorm-role-${role}`)).toHaveCount(0)
  }
})

// Regression: the board column was a flex item without `min-w-0`, so its
// automatic minimum size came from Excalidraw's own content instead of the
// available row width. The editor grew to its intrinsic size, shoved the AI
// session panel past the right viewport edge and left the page with a
// horizontal scrollbar — the panel was only reachable by scrolling sideways.
test("brainstorm v2: the AI panel stays on screen beside the editor, with no horizontal overflow", async ({
  page,
}) => {
  seedExcalidrawBoard()
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto("/projects/excalidraw-demo?tab=brainstorm:seeded-sketch")
  await expect(page.getByTestId("excalidraw-board")).toBeVisible({ timeout: 15_000 })
  await expect(page.locator(".excalidraw").first()).toBeVisible({ timeout: 15_000 })

  const m = await page.evaluate(() => {
    const rect = (sel: string) =>
      document.querySelector(sel)?.getBoundingClientRect() ?? new DOMRect()
    const board = rect('[data-testid="excalidraw-board"]')
    const companion = rect('[data-testid="excalidraw-companion"]')
    const canvas = rect(".excalidraw .excalidraw__canvas")
    const doc = document.documentElement
    return {
      board: { left: board.left, right: board.right, width: board.width, bottom: board.bottom },
      companion: { left: companion.left, right: companion.right, width: companion.width },
      canvasWidth: canvas.width,
      docScrollWidth: doc.scrollWidth,
      docClientWidth: doc.clientWidth,
      viewport: { width: window.innerWidth, height: window.innerHeight },
    }
  })

  // The panel is fully inside the viewport at its persisted/default width.
  expect(m.companion.width).toBeGreaterThan(200)
  expect(m.companion.right).toBeLessThanOrEqual(m.viewport.width + 1)
  // …and the page never scrolls sideways to reach it.
  expect(m.docScrollWidth).toBeLessThanOrEqual(m.docClientWidth)
  // The editor takes the rest of the row and stops where the panel starts.
  expect(m.board.width).toBeGreaterThan(300)
  expect(m.board.right).toBeLessThanOrEqual(m.companion.left + 1)
  // Excalidraw's own canvas fills the column it was given (no clipped editor).
  expect(m.canvasWidth).toBeGreaterThan(m.board.width * 0.9)
  // And the editor reaches the bottom of the viewport rather than overflowing it.
  expect(m.viewport.height - m.board.bottom).toBeLessThan(24)

  // A window narrow enough that the panel's own width no longer fits gives
  // width back to the panel instead of overflowing the row off-screen.
  await page.setViewportSize({ width: 820, height: 700 })
  const narrow = await page.evaluate(() => {
    const rect = (sel: string) =>
      document.querySelector(sel)?.getBoundingClientRect() ?? new DOMRect()
    return {
      boardWidth: rect('[data-testid="excalidraw-board"]').width,
      companionRight: rect('[data-testid="excalidraw-companion"]').right,
      docScrollWidth: document.documentElement.scrollWidth,
      docClientWidth: document.documentElement.clientWidth,
      viewportWidth: window.innerWidth,
    }
  })
  expect(narrow.companionRight).toBeLessThanOrEqual(narrow.viewportWidth + 1)
  expect(narrow.docScrollWidth).toBeLessThanOrEqual(narrow.docClientWidth)
  expect(narrow.boardWidth).toBeGreaterThan(0)
})

test("brainstorm v2: the ✎+ button creates an excalidraw board and switches to it", async ({
  page,
}) => {
  seedExcalidrawBoard()
  await page.goto("/projects/excalidraw-demo?tab=brainstorm")
  await expect(page.getByTestId("brainstorm-subtabs")).toBeVisible({ timeout: 15_000 })

  await page.getByTestId("brainstorm-new-excalidraw").click()
  await page.getByTestId("brainstorm-new-excalidraw-input").fill("fresh-sketch")
  await page.getByTestId("brainstorm-new-excalidraw-input").press("Enter")

  await expect(page.getByTestId("brainstorm-subtab-fresh-sketch")).toBeVisible({
    timeout: 15_000,
  })
  await expect(page.getByTestId("brainstorm-subtab-fresh-sketch")).toHaveAttribute(
    "data-active",
    "true",
  )
  await expect(page.getByTestId("excalidraw-status")).toHaveText("live", { timeout: 15_000 })
})

test("daemon excalidraw routes: kind-aware create/list and byte-preserving document round-trip", async ({
  request,
}) => {
  seedExcalidrawBoard()
  const base = `http://localhost:${DAEMON_PORT}/projects/excalidraw-demo/brainstorms`

  const body = (await (await request.get(base)).json()) as Array<{ id: string; kind: string }>
  expect(body).toContainEqual(expect.objectContaining({ id: "seeded-sketch", kind: "excalidraw" }))

  const created = await request.post(base, {
    data: { name: "api-made-sketch", kind: "excalidraw" },
  })
  expect(created.status()).toBe(201)
  expect(((await created.json()) as { kind: string }).kind).toBe("excalidraw")

  const badKind = await request.post(base, { data: { name: "bad-kind", kind: "vsdx" } })
  expect(badKind.status()).toBe(400)

  // Document round-trip preserves unknown Excalidraw keys byte-for-byte.
  const doc = await request.get(`${base}/seeded-sketch/excalidraw`)
  expect(doc.ok()).toBeTruthy()
  expect(await doc.json()).toEqual(seededDoc)

  const next = { ...seededDoc, elements: [...seededDoc.elements, { id: "el2", type: "ellipse" }] }
  const published = await request.post(`${base}/seeded-sketch/excalidraw`, { data: next })
  expect(published.ok()).toBeTruthy()
  expect(await published.json()).toEqual(next)

  const traversal = await request.get(`${base}/..%2fsecrets/excalidraw`)
  expect([400, 404]).toContain(traversal.status())
})
