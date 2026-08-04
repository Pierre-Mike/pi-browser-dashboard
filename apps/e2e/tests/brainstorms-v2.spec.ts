import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { expect, test } from "@playwright/test"
import { dispatchDirect, ensureProject, sessionRootOf, waitForSessionInRegistry } from "./helpers"

// End-to-end Excalidraw boards: a native `*.excalidraw` file anywhere in the
// session's worktree shares the same boards rail as the canvas documents, the
// embedded Excalidraw editor binds to it over the session-scoped excalidraw ws
// route, and this session's own terminal is docked beside it. global-setup runs
// the real daemon + web; the document is seeded on disk so discovery runs
// against a real filesystem.
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

const seedExcalidrawBoard = async (
  project: string,
): Promise<{ short: string; root: string; boardTab: string }> => {
  const cwd = ensureProject(project)
  const { short } = await dispatchDirect(undefined, { cwd })
  const root = sessionRootOf(await waitForSessionInRegistry(short))
  writeFileSync(join(root, "seeded-sketch.excalidraw"), JSON.stringify(seededDoc))
  return { short, root, boardTab: `brainstorm:${encodeURIComponent("seeded-sketch.excalidraw")}` }
}

test("excalidraw board: lists in the boards rail and binds the live Excalidraw editor", async ({
  page,
}) => {
  const { short, boardTab } = await seedExcalidrawBoard("excalidraw-demo")
  await page.goto(`/sessions/${short}?tab=${boardTab}`)
  await expect(page.getByTestId("session-topbar")).toBeVisible({ timeout: 15_000 })

  // The board shares the canvas boards' rail and deep-link scheme.
  await expect(page.getByTestId("brainstorm-subtab-seeded-sketch")).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId("brainstorm-subtab-seeded-sketch")).toHaveAttribute(
    "data-active",
    "true",
  )

  // The Excalidraw editor (not the React-Flow canvas) binds to the document:
  // the sync badge reaching "live" proves the excalidraw ws path end-to-end.
  await expect(page.getByTestId("excalidraw-board")).toBeVisible()
  await expect(page.getByTestId("excalidraw-status")).toHaveText("live", { timeout: 15_000 })
  await expect(page.getByTestId("canvas-tab")).toHaveCount(0)

  // Excalidraw itself mounted (it renders its own .excalidraw root).
  await expect(page.locator(".excalidraw").first()).toBeVisible({ timeout: 15_000 })

  // The board docks no terminal of its own: the drill-in's permanent terminal
  // sits to the LEFT of the whole pane, and the board keeps only the button that
  // briefs that session about it.
  await expect(page.getByTestId("brainstorm-companion")).toHaveCount(0)
  await expect(page.getByTestId("session-terminal-pane")).toBeVisible()
  await expect(page.getByTestId("brainstorm-brief-ai")).toBeVisible()
})

// Regression: the board column was a flex item without `min-w-0`, so its
// automatic minimum size came from Excalidraw's own content instead of the
// available row width. The editor grew to its intrinsic size, shoved its
// neighbour past a viewport edge and left the page with a horizontal scrollbar.
// Under the split the neighbour is the drill-in's terminal, and the direction
// flipped — the board is docked to the RIGHT of it — so the overflow this guards
// against would now push the terminal off the left edge.
test("excalidraw board: the terminal stays on screen beside the editor, with no horizontal overflow", async ({
  page,
}) => {
  const { short, boardTab } = await seedExcalidrawBoard("excalidraw-layout")
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`/sessions/${short}?tab=${boardTab}`)
  await expect(page.getByTestId("excalidraw-board")).toBeVisible({ timeout: 15_000 })
  await expect(page.locator(".excalidraw").first()).toBeVisible({ timeout: 15_000 })

  const m = await page.evaluate(() => {
    const rect = (sel: string) =>
      document.querySelector(sel)?.getBoundingClientRect() ?? new DOMRect()
    const board = rect('[data-testid="excalidraw-board"]')
    const terminal = rect('[data-testid="session-terminal-pane"]')
    const canvas = rect(".excalidraw .excalidraw__canvas")
    const doc = document.documentElement
    return {
      board: { left: board.left, right: board.right, width: board.width, bottom: board.bottom },
      terminal: { left: terminal.left, right: terminal.right, width: terminal.width },
      canvasWidth: canvas.width,
      docScrollWidth: doc.scrollWidth,
      docClientWidth: doc.clientWidth,
      viewport: { width: window.innerWidth, height: window.innerHeight },
    }
  })

  // The terminal keeps a real column, fully on screen, with the board beside it.
  expect(m.terminal.width).toBeGreaterThan(200)
  expect(m.terminal.left).toBeGreaterThanOrEqual(-1)
  // …and the page never scrolls sideways to reach either one.
  expect(m.docScrollWidth).toBeLessThanOrEqual(m.docClientWidth)
  // The editor takes the pane it was given and starts after the terminal ends.
  expect(m.board.width).toBeGreaterThan(250)
  expect(m.board.left).toBeGreaterThanOrEqual(m.terminal.right - 1)
  // Excalidraw's own canvas fills the column it was given (no clipped editor).
  expect(m.canvasWidth).toBeGreaterThan(m.board.width * 0.9)
  // And the editor reaches the bottom of the viewport rather than overflowing it.
  expect(m.viewport.height - m.board.bottom).toBeLessThan(24)

  // A window narrow enough that the pane's own width no longer fits gives width
  // back to the pane instead of overflowing the row off-screen.
  await page.setViewportSize({ width: 820, height: 700 })
  const narrow = await page.evaluate(() => {
    const rect = (sel: string) =>
      document.querySelector(sel)?.getBoundingClientRect() ?? new DOMRect()
    return {
      boardWidth: rect('[data-testid="excalidraw-board"]').width,
      paneRight: rect('[data-testid="session-side-pane"]').right,
      docScrollWidth: document.documentElement.scrollWidth,
      docClientWidth: document.documentElement.clientWidth,
      viewportWidth: window.innerWidth,
    }
  })
  expect(narrow.paneRight).toBeLessThanOrEqual(narrow.viewportWidth + 1)
  expect(narrow.docScrollWidth).toBeLessThanOrEqual(narrow.docClientWidth)
  expect(narrow.boardWidth).toBeGreaterThan(0)
})

test("excalidraw board: the ✎+ button creates one under brainstorms/ and switches to it", async ({
  page,
}) => {
  const { short } = await seedExcalidrawBoard("excalidraw-create")
  await page.goto(`/sessions/${short}?tab=brainstorm`)
  await expect(page.getByTestId("brainstorm-subtabs")).toBeVisible({ timeout: 15_000 })

  await page.getByTestId("brainstorm-new-excalidraw").click()
  await page.getByTestId("brainstorm-new-excalidraw-input").fill("fresh-sketch")
  await page.getByTestId("brainstorm-new-excalidraw-input").press("Enter")

  await expect(page.getByTestId("brainstorm-subtab-fresh-sketch")).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId("brainstorm-subtab-fresh-sketch")).toHaveAttribute(
    "data-active",
    "true",
  )
  await expect(page.getByTestId("brainstorm-board-file")).toHaveText(
    "brainstorms/fresh-sketch.excalidraw",
  )
  await expect(page.getByTestId("excalidraw-status")).toHaveText("live", { timeout: 15_000 })
})

test("daemon excalidraw routes: format-aware create and byte-preserving document round-trip", async ({
  request,
}) => {
  const { short } = await seedExcalidrawBoard("excalidraw-api")
  const base = `http://localhost:${DAEMON_PORT}/sessions/${short}/brainstorms`
  const docUrl = `${base}/excalidraw?path=${encodeURIComponent("seeded-sketch.excalidraw")}`

  const list = (await (await request.get(base)).json()) as Array<{ path: string; kind: string }>
  expect(list).toContainEqual(
    expect.objectContaining({ path: "seeded-sketch.excalidraw", kind: "excalidraw" }),
  )

  const created = await request.post(base, {
    data: { name: "api-made-sketch", kind: "excalidraw" },
  })
  expect(created.status()).toBe(201)
  expect(await created.json()).toMatchObject({
    path: "brainstorms/api-made-sketch.excalidraw",
    kind: "excalidraw",
  })

  // Document round-trip preserves unknown Excalidraw keys byte-for-byte.
  const doc = await request.get(docUrl)
  expect(doc.ok()).toBeTruthy()
  expect(await doc.json()).toEqual(seededDoc)

  const next = { ...seededDoc, elements: [...seededDoc.elements, { id: "el2", type: "ellipse" }] }
  const published = await request.post(docUrl, { data: next })
  expect(published.ok()).toBeTruthy()
  expect(await published.json()).toEqual(next)

  // The excalidraw routes serve only .excalidraw files, and never outside the tree.
  const wrongFormat = await request.get(
    `${base}/excalidraw?path=${encodeURIComponent("brainstorms/api-made-sketch.canvas")}`,
  )
  expect(wrongFormat.status()).toBe(404)
  const traversal = await request.get(
    `${base}/excalidraw?path=${encodeURIComponent("../secrets.excalidraw")}`,
  )
  expect([400, 403, 404]).toContain(traversal.status())
})
