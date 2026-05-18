import { expect, test } from "@playwright/test"
import {
  cardLocator,
  dispatchDirect,
  killDaemon,
  restartDaemon,
  rmSession,
  startDaemon,
  stopExternal,
  waitForCard,
  waitForCardGone,
  waitForSettled,
} from "./helpers"

const DAEMON = `http://localhost:${process.env.PID_E2E_DAEMON_PORT ?? 18787}`

// Stub mode can't replicate real claude's "stop on a settled session removes
// it from the roster" branch: matching it would also remove the card when
// drill-in-actions / spawn-stop click Kill on an idle session, breaking
// those tests. With real CLI this is a one-call asymmetry the daemon
// exploits. Skip in stub mode.
const STUB = process.env.PID_E2E_USE_STUB === "1" || process.env.CI === "true"

test.skip(STUB, "stub claude lacks done-session roster-removal on stop")
test("daemon restart: SSE watchdog reconnects, post-restart deltas reach the UI", async ({
  page,
}) => {
  await page.addInitScript(() => {
    ;(window as { __PID_SSE_DEBUG__?: boolean }).__PID_SSE_DEBUG__ = true
  })
  await page.goto("/")
  const { short } = await dispatchDirect()
  try {
    await waitForCard(page, short, 20_000)
    await waitForSettled(page, short)

    await killDaemon()
    await startDaemon()
    // The client's SSE watchdog reconnects after ~25s of silence; an external
    // state change is then picked up via the fresh stream.
    await stopExternal(short)

    // Sanity: the daemon already reflects the removal.
    await expect(async () => {
      const r = await fetch(`${DAEMON}/sessions`)
      const body = (await r.json()) as Array<{ short: string }>
      expect(body.find((s) => s.short === short)).toBeUndefined()
    }).toPass({ timeout: 10_000 })

    // Watchdog (25s threshold + 5s poll) → up to 30s until client reconnects
    // and a fresh /sessions fetch lands.
    await waitForCardGone(page, short, 45_000)
  } finally {
    try {
      await page.request.get(`${DAEMON}/sessions`, { timeout: 1_000 })
    } catch {
      await restartDaemon()
    }
    rmSession(short)
  }
})
