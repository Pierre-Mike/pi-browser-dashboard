import { expect, test } from "@playwright/test"

// Phase 3 — the Extensions management panel. global-setup seeds the permission-
// free "e2e-iframe" fixture; its index.html retries listFiles until it succeeds.
// These tests drive the enable/disable toggle and per-capability grants and
// assert the effects (RPC flips from denied→ok; disabled extensions lose their
// dashboard tab). State is persisted in the daemon, so afterAll restores the
// baseline (enabled, no grants) to avoid leaking into other specs.

const DAEMON = `http://localhost:${process.env.PID_E2E_DAEMON_PORT ?? 18787}`

test.afterAll(async ({ request }) => {
  await request.post(`${DAEMON}/extensions/e2e-iframe/enable`).catch(() => {})
  await request
    .post(`${DAEMON}/extensions/e2e-iframe/grants`, { data: { fs: [], events: false } })
    .catch(() => {})
})

test("granting fs lets the iframe's listFiles RPC succeed without a reload", async ({ page }) => {
  await page.goto("/")
  await expect(page.getByTestId("dashboard")).toBeVisible({ timeout: 15_000 })

  // Confirm the gate is closed first: on the extension's tab, listFiles is denied.
  await page.getByTestId("dashboard-tab-ext-e2e-iframe").click()
  const frame = page.frameLocator('[data-testid="extension-host-e2e-iframe"]')
  await expect(frame.getByTestId("ext-deny")).toContainText("permission", { timeout: 15_000 })

  // Open the management panel and grant `fs`.
  await page.getByTestId("dashboard-tab-extensions").click()
  await expect(page.getByTestId("ext-row-e2e-iframe")).toBeVisible()
  // Use click(), not check(): the checkbox is controlled and its `checked`
  // prop only flips after the grants POST + query refetch (async), so check()'s
  // synchronous state assertion would fail. click() fires onChange to grant.
  await page.getByTestId("ext-grant-e2e-iframe-fs").click()
  // Confirm the grant landed (checkbox reflects it after refetch).
  await expect(page.getByTestId("ext-grant-e2e-iframe-fs")).toBeChecked({ timeout: 15_000 })

  // Back on the extension tab, the bridge re-mounts with the new grant and the
  // fixture's next listFiles poll succeeds — the denial clears.
  await page.getByTestId("dashboard-tab-ext-e2e-iframe").click()
  await expect(frame.getByTestId("ext-deny")).toContainText("listFiles-ok", { timeout: 15_000 })
  await expect(frame.getByTestId("ext-deny")).not.toContainText("permission")
})

test("disabling an extension removes its dashboard tab", async ({ page }) => {
  await page.goto("/")
  await expect(page.getByTestId("dashboard")).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId("dashboard-tab-ext-e2e-iframe")).toBeVisible({ timeout: 15_000 })

  await page.getByTestId("dashboard-tab-extensions").click()
  await expect(page.getByTestId("ext-row-e2e-iframe")).toBeVisible()
  await page.getByTestId("ext-enable-e2e-iframe").click() // currently enabled → disable

  // The extension's dashboard tab disappears once the query refetches.
  await expect(page.getByTestId("dashboard-tab-ext-e2e-iframe")).toHaveCount(0, { timeout: 15_000 })

  // Re-enable from the panel; the tab returns.
  await page.getByTestId("ext-enable-e2e-iframe").click()
  await expect(page.getByTestId("dashboard-tab-ext-e2e-iframe")).toBeVisible({ timeout: 15_000 })
})
