import { expect, test } from "@playwright/test"
import { cardLocator, dispatchDirect, rmSession, waitForCard, waitForSettled } from "./helpers"

const DAEMON = `http://localhost:${process.env.PID_E2E_DAEMON_PORT ?? 18787}`

// The supervisor doesn't process user input for unauth'd sandbox sessions
// (state.json stays at "blocked"), so this test verifies the *wiring* end to
// end: panel toggle, preset click, free-form submit each cause a POST /send
// that the daemon accepts. Real input delivery is covered manually against
// an authed session (see AGENTS.md — "no documented IPC for external reply").
test("send-keys: panel → presets → free-form all POST /send and report sent", async ({ page }) => {
  await page.goto("/")
  const { short } = await dispatchDirect()
  try {
    await waitForCard(page, short, 20_000)
    await waitForSettled(page, short)

    const card = cardLocator(page, short)
    const panel = card.getByTestId("send-panel")

    // Panel is open by default only for state=needs_input; sandbox sessions
    // land in idle, so click the toggle.
    if (await panel.count() === 0) {
      await card.getByTestId("send-toggle").click()
    }
    await expect(panel).toBeVisible()

    // Preset: "y" → keys=`y\r`
    const presetResp = page.waitForResponse(
      (r) => r.url().includes(`/sessions/${short}/send`) && r.request().method() === "POST",
      { timeout: 15_000 },
    )
    await panel.getByTestId("send-preset-y").click()
    const presetReq = (await presetResp).request()
    const presetBody = JSON.parse(presetReq.postData() ?? "{}") as { keys?: string }
    expect(presetBody.keys).toBe("y\r")
    expect((await presetResp).ok()).toBeTruthy()
    await expect(panel.getByTestId("send-status")).toContainText(/sent/i, { timeout: 5_000 })

    // Status auto-clears after 2.5s; wait it out so the next assertion is clean.
    await expect(panel.getByTestId("send-status")).toHaveCount(0, { timeout: 5_000 })

    // Free-form: type "hello" + Enter, expect `hello\r` to be sent.
    const freeResp = page.waitForResponse(
      (r) => r.url().includes(`/sessions/${short}/send`) && r.request().method() === "POST",
      { timeout: 15_000 },
    )
    await panel.getByTestId("send-freeform").fill("hello")
    await panel.getByTestId("send-freeform").press("Enter")
    const freeReq = (await freeResp).request()
    const freeBody = JSON.parse(freeReq.postData() ?? "{}") as { keys?: string }
    expect(freeBody.keys).toBe("hello\r")
    expect((await freeResp).ok()).toBeTruthy()
    await expect(panel.getByTestId("send-status")).toContainText(/sent/i, { timeout: 5_000 })
  } finally {
    rmSession(short)
  }
})

test("send-keys: daemon rejects empty/oversized keys at the route boundary", async () => {
  const { short } = await dispatchDirect()
  try {
    const empty = await fetch(`${DAEMON}/sessions/${short}/send`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ keys: "" }),
    })
    expect(empty.status).toBe(400)
    expect(((await empty.json()) as { error?: string }).error).toBe("bad_keys")

    const missing = await fetch(`${DAEMON}/sessions/${short}/send`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    })
    expect(missing.status).toBe(400)
    expect(((await missing.json()) as { error?: string }).error).toBe("bad_keys")

    const huge = "x".repeat(5_000)
    const oversized = await fetch(`${DAEMON}/sessions/${short}/send`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ keys: huge }),
    })
    expect(oversized.status).toBe(413)
    expect(((await oversized.json()) as { error?: string }).error).toBe("keys_too_long")
  } finally {
    rmSession(short)
  }
})
