import { existsSync, readFileSync } from "node:fs"
import { type Page, expect, test } from "@playwright/test"
import { dispatchDirect, ensureProject, rmSession, waitForCard, waitForSettled } from "./helpers"

// Dispatch a synthetic `drop` DragEvent at the document root carrying one
// in-memory file. Playwright cannot deliver a real OS-level drag, but the
// DropZone listens via `window.addEventListener("drop", ...)` and only reads
// `dataTransfer.files` / `dataTransfer.types`, so a JS-constructed event is
// indistinguishable from the real thing for this code path.
const dropFile = async (
  page: Page,
  payload: { readonly name: string; readonly contents: string; readonly type?: string },
): Promise<void> => {
  const dataTransfer = await page.evaluateHandle(
    ({ name, contents, type }) => {
      const dt = new DataTransfer()
      const file = new File([contents], name, { type: type ?? "text/plain" })
      dt.items.add(file)
      return dt
    },
    { name: payload.name, contents: payload.contents, type: payload.type },
  )
  await page.dispatchEvent("html", "drop", { dataTransfer })
}

test("drop a file on the dashboard: daemon writes it to disk and returns the path", async ({
  page,
}) => {
  const sandbox = process.env.PID_E2E_SANDBOX
  if (!sandbox) throw new Error("PID_E2E_SANDBOX missing — globalSetup did not run")

  await page.goto("/")

  const uploadResp = page.waitForResponse(
    (r) => r.url().endsWith("/uploads") && r.request().method() === "POST" && r.ok(),
    { timeout: 15_000 },
  )
  await dropFile(page, { name: "drop-probe.txt", contents: "hello drop" })
  const resp = await uploadResp
  const body = (await resp.json()) as { path: string }

  expect(body.path).toMatch(/pid-uploads\/\d{4}-\d{2}-\d{2}\/.+-drop-probe\.txt$/)
  expect(body.path.startsWith(sandbox)).toBe(true)
  expect(existsSync(body.path)).toBe(true)
  expect(readFileSync(body.path, "utf8")).toBe("hello drop")

  // Toast surface confirms user-visible feedback fired.
  await expect(page.locator('[data-testid="dropzone-toasts"]')).toContainText("Uploaded")
})

test("drop while spawn modal is open: absolute path is appended into the intent textarea", async ({
  page,
}) => {
  ensureProject("drop-target-project", { gitInit: true })
  await page.goto("/")

  // Sidebar spawn buttons appear once the projects roster is populated.
  const spawnBtn = page.locator('[data-testid="sidebar-spawn"]').first()
  await expect(spawnBtn).toBeVisible({ timeout: 15_000 })
  await spawnBtn.click()

  const modal = page.locator('[data-testid="spawn-modal"]')
  await expect(modal).toBeVisible()
  const textarea = page.getByPlaceholder("What should this session do?")
  await textarea.fill("review this")

  const uploadResp = page.waitForResponse(
    (r) => r.url().endsWith("/uploads") && r.request().method() === "POST" && r.ok(),
    { timeout: 15_000 },
  )
  await dropFile(page, { name: "spec.md", contents: "# spec" })
  const { path } = (await (await uploadResp).json()) as { path: string }

  // appendPath: existing content + space + absolute path.
  await expect(textarea).toHaveValue(`review this ${path}`)
})

test("drop while a session is open: absolute path is appended into the ChatComposer textarea", async ({
  page,
}) => {
  await page.goto("/")
  const { short } = await dispatchDirect()
  try {
    await waitForCard(page, short, 20_000)
    await waitForSettled(page, short)
    await page.goto(`/sessions/${short}`)

    // Session view defaults to the Terminal tab; the ChatComposer lives behind
    // the Chat tab. Click it to mount the textarea before dropping.
    await page.getByTestId("tab-chat").click()
    const composer = page.getByTestId("chat-textarea")
    await expect(composer).toBeVisible({ timeout: 10_000 })
    await composer.fill("look at")

    const uploadResp = page.waitForResponse(
      (r) => r.url().endsWith("/uploads") && r.request().method() === "POST" && r.ok(),
      { timeout: 15_000 },
    )
    await dropFile(page, { name: "context.md", contents: "# context" })
    const { path } = (await (await uploadResp).json()) as { path: string }

    await expect(composer).toHaveValue(`look at ${path}`)
  } finally {
    rmSession(short)
  }
})

test("drop while the global terminal is active: path is sent over the pty WebSocket", async ({
  page,
}) => {
  const ptyFrames: string[] = []
  // Capture frames the page sends to the terminal WS *before* navigating so
  // we don't miss the initial open. Filter for the terminal endpoint so we
  // don't see SSE or other sockets (the dashboard only has one WS today,
  // but the filter keeps the assertion focused).
  page.on("websocket", (ws) => {
    if (!ws.url().includes("/terminal/")) return
    ws.on("framesent", ({ payload }) => {
      ptyFrames.push(typeof payload === "string" ? payload : payload.toString("utf8"))
    })
  })

  await page.goto("/")
  // Dashboard defaults to the Terminal tab; wait for the host to render and
  // for the status badge to flip to "open" so the WS is connected before we drop.
  await expect(page.getByTestId("global-terminal")).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId("global-terminal")).toContainText("open", { timeout: 20_000 })

  const uploadResp = page.waitForResponse(
    (r) => r.url().endsWith("/uploads") && r.request().method() === "POST" && r.ok(),
    { timeout: 15_000 },
  )
  await dropFile(page, { name: "term-target.md", contents: "# t" })
  const { path } = (await (await uploadResp).json()) as { path: string }

  await expect
    .poll(() => ptyFrames.some((f) => f.includes(path)), { timeout: 10_000 })
    .toBeTruthy()
})
