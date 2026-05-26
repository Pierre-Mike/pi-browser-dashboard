import { existsSync, readFileSync } from "node:fs"
import { type Page, expect, test } from "@playwright/test"
import { ensureProject } from "./helpers"

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
