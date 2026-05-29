import { expect, test } from "@playwright/test"

// Phase 2 — the web iframe extension host. global-setup.ts seeds a
// permission-free iframe-tier extension ("e2e-iframe") under PID_EXT_LOCAL_DIR.
// The daemon (Phase 1) discovers it, mounts it, and serves its index.html at
// /extensions/e2e-iframe/index.html. The dashboard appends a tab for it; the
// sandboxed iframe talks to the host over the postMessage RPC bridge.
test("iframe extension: tab appears, iframe loads, RPC roundtrip + permission deny", async ({
  page,
}) => {
  await page.goto("/")
  await expect(page.getByTestId("dashboard")).toBeVisible({ timeout: 15_000 })

  // The extension contributes a top-level dashboard tab.
  const extTab = page.getByTestId("dashboard-tab-ext-e2e-iframe")
  await expect(extTab).toBeVisible({ timeout: 15_000 })

  await extTab.click()
  await expect(extTab).toHaveAttribute("data-active", "true")
  await expect(page.getByTestId("dashboard-tab-panel-ext-e2e-iframe")).toBeVisible()

  // The sandboxed iframe is served from the daemon and rendered by ExtensionHost.
  const frame = page.frameLocator('[data-testid="extension-host-e2e-iframe"]')

  // getContext requires no permission → resolves with the extension name.
  await expect(frame.getByTestId("ext-ctx")).toContainText("ctx:e2e-iframe", { timeout: 15_000 })

  // listFiles needs the `fs` capability, which this extension never requested →
  // the RPC bridge's permission gate rejects it.
  await expect(frame.getByTestId("ext-deny")).toContainText("permission", { timeout: 15_000 })
  await expect(frame.getByTestId("ext-deny")).not.toContainText("UNEXPECTED-OK")
})

// The sanitized /extensions listing must never leak permission values, and the
// daemon's static route must reject path traversal (Phase 1 contract the web
// host depends on).
test("daemon /extensions listing is present and static route rejects traversal", async ({
  request,
}) => {
  // The e2e daemon runs on PID_E2E_DAEMON_PORT (default 18787) — see global-setup.ts.
  const daemonUrl = `http://localhost:${process.env.PID_E2E_DAEMON_PORT ?? 18787}`

  const list = await request.get(`${daemonUrl}/extensions`)
  expect(list.ok()).toBeTruthy()
  const body = (await list.json()) as Array<Record<string, unknown>>
  const ext = body.find((e) => e.name === "e2e-iframe")
  expect(ext).toBeTruthy()
  // permissions are exposed as a key summary array, never raw fs/exec values.
  expect(Array.isArray(ext?.permissions)).toBeTruthy()

  const traverse = await request.get(`${daemonUrl}/extensions/e2e-iframe/..%2f..%2fmanifest.json`)
  expect([400, 404]).toContain(traverse.status())
})
