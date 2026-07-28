import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { expect, test } from "@playwright/test"
import { dispatchDirect, ensureProject, sessionRootOf, waitForSessionInRegistry } from "./helpers"

// End-to-end brainstorms, session-scoped. A board is any canvas file in the tree
// the session works in — no blessed directory — so the specs seed one *outside*
// `brainstorms/` and expect it listed anyway. global-setup runs the real daemon
// + web; the documents are seeded on disk so discovery runs against a real
// filesystem, and the root is read back from the daemon so the same spec works
// whether the session got an isolated worktree (real mode) or works in its cwd
// (stub mode).
const DAEMON_PORT = process.env.PID_E2E_DAEMON_PORT ?? 18787

// Obsidian JSON Canvas — the format `.canvas` boards are stored in.
const seededCanvas = {
  nodes: [{ id: "n1", type: "text", x: 40, y: 40, width: 200, height: 60, text: "seeded idea" }],
  edges: [],
}

const seedBoard = async (input: {
  readonly project: string
  readonly path: string
  readonly body: unknown
}): Promise<{ short: string; root: string }> => {
  const cwd = ensureProject(input.project)
  const { short } = await dispatchDirect(undefined, { cwd })
  const root = sessionRootOf(await waitForSessionInRegistry(short))
  const file = join(root, input.path)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(input.body))
  return { short, root }
}

test("brainstorm: a .canvas anywhere in the worktree lists in the rail and binds the live canvas", async ({
  page,
}) => {
  // Deliberately not under brainstorms/ — discovery is by suffix over the tree.
  const { short } = await seedBoard({
    project: "brainstorm-demo",
    path: "docs/arch.canvas",
    body: seededCanvas,
  })

  await page.goto(`/sessions/${short}?tab=brainstorm`)
  await expect(page.getByTestId("session-topbar")).toBeVisible({ timeout: 15_000 })

  // Brainstorm is a docked section of the drill-in, and boards hang off its rail.
  await expect(page.getByTestId("tab-brainstorm")).toHaveAttribute("data-active", "true")
  await expect(page.getByTestId("brainstorm-subtab-docs/arch")).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId("brainstorm-subtab-docs/arch")).toHaveAttribute(
    "data-active",
    "true",
  )

  // The shared canvas editor binds to the document over the session-scoped ws
  // route: the sync badge reaching "live" proves the whole WS path end-to-end.
  await expect(page.getByTestId("canvas-tab")).toBeVisible()
  await expect(page.getByTestId("canvas-status")).toHaveText("live", { timeout: 15_000 })

  // The seeded Obsidian node made it from disk onto the canvas — proof the
  // .canvas codec decoded, not just that a socket opened.
  await expect(page.getByText("seeded idea")).toBeVisible({ timeout: 15_000 })

  // This session's own terminal is docked beside the board, and "Brief AI" works
  // here now: the board lives in this session's tree, so its writes land in the
  // file on screen.
  await expect(page.getByTestId("brainstorm-companion")).toBeVisible()
  await expect(page.getByTestId("canvas-brief-ai")).toBeVisible()
  await expect(page.getByTestId("brainstorm-board-file")).toHaveText("docs/arch.canvas")
})

test("brainstorm: a deep link selects one board by its path", async ({ page }) => {
  const { short, root } = await seedBoard({
    project: "brainstorm-deeplink",
    path: "docs/arch.canvas",
    body: seededCanvas,
  })
  // A second board, alphabetically first, so "the linked board" and "the
  // fallback board" are not the same one.
  writeFileSync(join(root, "aaa.canvas"), JSON.stringify({ nodes: [], edges: [] }))

  await page.goto(`/sessions/${short}?tab=brainstorm:${encodeURIComponent("docs/arch.canvas")}`)
  await expect(page.getByTestId("brainstorm-subtab-docs/arch")).toHaveAttribute(
    "data-active",
    "true",
    { timeout: 15_000 },
  )
  await expect(page.getByTestId("brainstorm-subtab-aaa")).toHaveAttribute("data-active", "false")
})

test("brainstorm: the + button creates a board under brainstorms/ and switches to it", async ({
  page,
}) => {
  const { short } = await seedBoard({
    project: "brainstorm-create",
    path: "docs/arch.canvas",
    body: seededCanvas,
  })

  await page.goto(`/sessions/${short}?tab=brainstorm`)
  await expect(page.getByTestId("brainstorm-subtabs")).toBeVisible({ timeout: 15_000 })

  await page.getByTestId("brainstorm-new").click()
  await page.getByTestId("brainstorm-new-input").fill("fresh-board")
  await page.getByTestId("brainstorm-new-input").press("Enter")

  await expect(page.getByTestId("brainstorm-subtab-fresh-board")).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId("brainstorm-subtab-fresh-board")).toHaveAttribute(
    "data-active",
    "true",
  )
  // Created inside brainstorms/ by default — the label drops that prefix, the
  // panel shows where the file really landed.
  await expect(page.getByTestId("brainstorm-board-file")).toHaveText(
    "brainstorms/fresh-board.canvas",
  )
  await expect(page.getByTestId("canvas-status")).toHaveText("live", { timeout: 15_000 })
})

test("brainstorm: the session panel beside the board is resizable", async ({ page }) => {
  const { short } = await seedBoard({
    project: "brainstorm-resize",
    path: "docs/arch.canvas",
    body: seededCanvas,
  })
  await page.goto(`/sessions/${short}?tab=brainstorm`)
  const panel = page.getByTestId("brainstorm-companion")
  await expect(panel).toBeVisible({ timeout: 15_000 })
  const handle = page.getByTestId("brainstorm-companion-resize")
  await expect(handle).toBeVisible()

  const widthOf = () => panel.evaluate((el) => el.getBoundingClientRect().width)
  const before = await widthOf()

  // The handle is a focusable splitter: ←/→ resize deterministically (mouse
  // drag is flaky headless). ArrowLeft widens the right-docked panel.
  await handle.focus()
  await page.keyboard.press("ArrowLeft")
  await page.keyboard.press("ArrowLeft")
  await expect.poll(widthOf).toBeGreaterThan(before)

  const widened = await widthOf()
  await page.keyboard.press("ArrowRight")
  await expect.poll(widthOf).toBeLessThan(widened)

  await handle.dblclick()
  await expect.poll(widthOf).toBe(384)
})

test("daemon brainstorm routes: list every format, create under brainstorms/, refuse traversal", async ({
  request,
}) => {
  const { short, root } = await seedBoard({
    project: "brainstorm-api",
    path: "docs/arch.canvas",
    body: seededCanvas,
  })
  // A legacy React-Flow board and an Excalidraw scene, both outside brainstorms/.
  writeFileSync(
    join(root, "legacy.canvas.json"),
    JSON.stringify({ version: 1, nodes: [], edges: [] }),
  )
  writeFileSync(join(root, "sketch.excalidraw"), JSON.stringify({ elements: [] }))

  const base = `http://localhost:${DAEMON_PORT}/sessions/${short}/brainstorms`

  const list = (await (await request.get(base)).json()) as Array<{ path: string; kind: string }>
  expect(list).toContainEqual(expect.objectContaining({ path: "docs/arch.canvas", kind: "canvas" }))
  expect(list).toContainEqual(
    expect.objectContaining({ path: "legacy.canvas.json", kind: "canvasJson" }),
  )
  expect(list).toContainEqual(
    expect.objectContaining({ path: "sketch.excalidraw", kind: "excalidraw" }),
  )

  const created = await request.post(base, { data: { name: "api-made" } })
  expect(created.status()).toBe(201)
  expect(await created.json()).toMatchObject({
    path: "brainstorms/api-made.canvas",
    kind: "canvas",
  })

  expect((await request.post(base, { data: { name: "api-made" } })).status()).toBe(409)
  expect((await request.post(base, { data: { name: "../escape" } })).status()).toBe(400)
  expect((await request.post(base, { data: { name: "x", kind: "vsdx" } })).status()).toBe(400)

  // A .canvas board decodes into the shared canvas wire shape…
  const snapshot = await request.get(
    `${base}/canvas?path=${encodeURIComponent("docs/arch.canvas")}`,
  )
  expect(snapshot.ok()).toBeTruthy()
  const snap = (await snapshot.json()) as { nodes: Array<{ data?: { label?: string } }> }
  expect(snap.nodes[0]?.data?.label).toBe("seeded idea")

  // …and a path that escapes the worktree is refused before any filesystem access.
  const traversal = await request.get(
    `${base}/canvas?path=${encodeURIComponent("../secrets.canvas")}`,
  )
  expect([400, 403, 404]).toContain(traversal.status())

  // An unknown session has no tree to list.
  expect(
    (
      await request.get(`http://localhost:${DAEMON_PORT}/sessions/nope-not-a-session/brainstorms`)
    ).status(),
  ).toBe(404)
})
