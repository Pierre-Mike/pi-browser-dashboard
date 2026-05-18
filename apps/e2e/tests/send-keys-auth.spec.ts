import { readFileSync } from "node:fs"
import { join } from "node:path"
import { expect, test } from "@playwright/test"
import { cardLocator, dispatchDirect, rmSession, waitForCard, waitForSettled } from "./helpers"

const authMode = (): boolean => {
  // The manifest written by global-setup records whether we're using a
  // persistent auth dir. Run only in that mode.
  try {
    const sandbox = process.env.PID_E2E_SANDBOX
    if (!sandbox) return false
    const m = JSON.parse(readFileSync(join(sandbox, ".e2e-manifest.json"), "utf8")) as {
      persistent?: boolean
    }
    return Boolean(m.persistent)
  } catch {
    return false
  }
}

// This suite drives the real `claude attach` TUI via `claude send-keys`-style
// input — the stub has no TUI to ingest keystrokes, so we skip whenever the
// stub is active even if a persistent auth dir is present locally.
const STUB = process.env.PID_E2E_USE_STUB === "1" || process.env.CI === "true"

test.describe("send-keys (real auth)", () => {
  test.skip(!authMode() || STUB, "requires PID_E2E_AUTH_DIR with a logged-in claude account")

  // Send a slash command — fast, no LLM round-trip, observable via state.json
  // updatedAt advancing. If the supervisor processes our input the state file
  // gets rewritten; if it doesn't, updatedAt stays frozen.
  test("UI Send → supervisor ingests input → state.json updatedAt advances", async ({ page }) => {
    const sandbox = process.env.PID_E2E_SANDBOX
    if (!sandbox) throw new Error("PID_E2E_SANDBOX missing")

    await page.goto("/")
    const { short } = await dispatchDirect()
    try {
      await waitForCard(page, short, 20_000)
      await waitForSettled(page, short)

      const statePath = join(sandbox, "jobs", short, "state.json")
      const updatedAtOf = (): string | undefined => {
        try {
          return (JSON.parse(readFileSync(statePath, "utf8")) as { updatedAt?: string }).updatedAt
        } catch {
          return undefined
        }
      }
      const before = updatedAtOf()
      expect(before, "state.json must exist with updatedAt before send").toBeTruthy()

      const card = cardLocator(page, short)
      const panel = card.getByTestId("send-panel")
      if ((await panel.count()) === 0) {
        await card.getByTestId("send-toggle").click()
      }
      await expect(panel).toBeVisible()

      // /help is cheap: the supervisor processes it locally without a model
      // call, but it still updates state.json on input.
      const resp = page.waitForResponse(
        (r) => r.url().includes(`/sessions/${short}/send`) && r.request().method() === "POST",
        { timeout: 20_000 },
      )
      await panel.getByTestId("send-freeform").fill("/help")
      await panel.getByTestId("send-freeform").press("Enter")
      expect((await resp).ok()).toBeTruthy()

      // The supervisor ingests input, the TUI redraws, state.json gets a new
      // updatedAt. Poll until we see it bump.
      await expect(async () => {
        const after = updatedAtOf()
        expect(after).toBeTruthy()
        expect(after).not.toBe(before)
      }).toPass({ timeout: 20_000 })
    } finally {
      rmSession(short)
    }
  })
})
