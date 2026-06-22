import { expect, test } from "@playwright/test"
import {
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

// Real-CLI-only: exercises a daemon kill/restart plus the client's ~30s SSE
// watchdog — too slow and environment-dependent for the stubbed CI runner.
const STUB = process.env.PID_E2E_USE_STUB === "1" || process.env.CI === "true"

test.skip(STUB, "daemon restart + SSE watchdog timing needs the real CLI")
test("daemon restart: SSE watchdog reconnects, post-restart deltas reach the UI", async ({
  page,
}) => {
  await page.addInitScript(() => {
    ;(window as { __PID_SSE_DEBUG__?: boolean }).__PID_SSE_DEBUG__ = true
  })
  await page.goto("/")
  const { short } = await dispatchDirect()
  try {
    await waitForCard({ page, short, timeout: 20_000 })
    await waitForSettled({ page, short })

    await killDaemon()
    await startDaemon()
    // The client's SSE watchdog reconnects after ~25s of silence; an external
    // state change is then picked up via the fresh stream. Stop alone leaves
    // the session retained (job dir persists) — rm deletes the job dir, the
    // one delta that evicts it from the registry.
    await stopExternal(short)
    rmSession(short)

    // Sanity: the daemon already reflects the removal.
    await expect(async () => {
      const r = await fetch(`${DAEMON}/sessions`)
      const body = (await r.json()) as Array<{ short: string }>
      expect(body.find((s) => s.short === short)).toBeUndefined()
    }).toPass({ timeout: 10_000 })

    // Watchdog (25s threshold + 5s poll) → up to 30s until client reconnects
    // and a fresh /sessions fetch lands.
    await waitForCardGone({ page, short, timeout: 45_000 })
  } finally {
    try {
      await page.request.get(`${DAEMON}/sessions`, { timeout: 1_000 })
    } catch {
      await restartDaemon()
    }
    rmSession(short)
  }
})
