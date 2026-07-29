import { expect, type Page, test } from "@playwright/test"

// The machine-wide theme default lives in the `ui` section of the global settings
// file and reaches the browser over `GET /settings`. Only an end-to-end run
// proves the whole chain — daemon file, wire, query, theme store, `data-theme` —
// because every link in it is green in unit tests already.
//
// Written literally rather than imported: apps/e2e drives the app from outside
// and must not reach into apps/web internals. Same rule as THEME_KEY in
// theme-switch.spec.ts, which owns the per-browser half of this behaviour.
const DAEMON = `http://localhost:${process.env.PID_E2E_DAEMON_PORT ?? 18787}`
const THEME_KEY = "pid:ui:theme"

const setMachineDefault = async (ui: { themeFamily: string; themeMode: string }): Promise<void> => {
  const res = await fetch(`${DAEMON}/settings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ui }),
  })
  expect(res.ok).toBe(true)
  expect((await res.json()).ui).toEqual(ui)
}

const open = async ({ page, stored }: { page: Page; stored?: string }): Promise<void> => {
  if (stored !== undefined) {
    await page.addInitScript(
      (seed: { key: string; value: string }) => window.localStorage.setItem(seed.key, seed.value),
      { key: THEME_KEY, value: stored },
    )
  }
  await page.goto("/")
  await expect(page.getByTestId("dashboard")).toBeVisible({ timeout: 15_000 })
}

// Every test clears the default in a `finally`. The settings file is shared by
// the whole suite — the runner is `workers: 1`, `fullyParallel: false`, so nothing
// races, but a default left behind would break the sibling specs that assert
// `pidlight` with no stored choice (`terminal-light-mode`, and the garbage-value
// case in `theme-switch`).
test("a browser with no pick of its own follows the machine-wide default", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" })
  try {
    await setMachineDefault({ themeFamily: "terminal", themeMode: "dark" })

    // No stored choice: the daemon's default decides, and it beats the OS
    // preference the same way an explicit local pick would.
    await open({ page })
    await expect(page.locator("html")).toHaveAttribute("data-theme", "terminaldark")

    // The Settings panel names it, so the hint is not lying about what a
    // different browser would see.
    await page.getByTestId("dashboard-tab-settings").click()
    await expect(page.getByTestId("gs-appearance-machine")).toContainText("Terminal")
    // …and it is already the default, so there is nothing to re-post.
    await expect(page.getByTestId("gs-appearance-set-default")).toBeDisabled()
  } finally {
    await setMachineDefault({ themeFamily: "", themeMode: "" })
  }
})

test("this browser's own pick overrides the machine default", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" })
  try {
    await setMachineDefault({ themeFamily: "terminal", themeMode: "dark" })
    await open({ page, stored: "sunset:light" })

    // Seeded before any app module ran, so this is also the no-flash assertion:
    // the store paints from localStorage synchronously, and the daemon value
    // arriving later changes nothing a browser with a pick can see.
    await expect(page.locator("html")).toHaveAttribute("data-theme", "sunsetlight")

    // Proof the daemon value really did land — the panel names it — rather than a
    // sleep, which would pass just as well if the query had never resolved.
    await page.getByTestId("dashboard-tab-settings").click()
    await expect(page.getByTestId("gs-appearance-machine")).toContainText("Terminal")
    await expect(page.locator("html")).toHaveAttribute("data-theme", "sunsetlight")
  } finally {
    await setMachineDefault({ themeFamily: "", themeMode: "" })
  }
})

test("writing the machine default from the Appearance section round-trips", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" })
  try {
    await open({ page, stored: "mono:dark" })
    await page.getByTestId("dashboard-tab-settings").click()
    await expect(page.getByTestId("gs-appearance-machine")).toHaveText("not set")

    await page.getByTestId("gs-appearance-set-default").click()
    await expect(page.getByTestId("gs-appearance-machine")).toContainText("Mono")
    await expect(page.getByTestId("gs-appearance-set-default")).toBeDisabled()

    const stored = await (await fetch(`${DAEMON}/settings`)).json()
    expect(stored.ui).toEqual({ themeFamily: "mono", themeMode: "dark" })
  } finally {
    await setMachineDefault({ themeFamily: "", themeMode: "" })
  }
})
