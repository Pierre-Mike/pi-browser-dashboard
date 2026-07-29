import { describe, expect, it } from "bun:test"
import {
  SCREEN_READING_MAX_AGE_MS,
  STALE_ACTIVE_MS,
  WAIT_TIMEOUT_DEFAULT_MS,
  WAIT_TIMEOUT_MAX_MS,
} from "./timing"

// Not tautologies: these are the invariants the *relationships* between the
// constants have to keep, and they are what a careless retune would break.
describe("protocol timing constants", () => {
  it("the default wait is within the maximum a client may ask for", () => {
    expect(WAIT_TIMEOUT_DEFAULT_MS).toBeLessThanOrEqual(WAIT_TIMEOUT_MAX_MS)
  })

  it("a default-length wait cannot outlive the staleness threshold", () => {
    // Otherwise a session could be reported stale while a wait on it is still
    // legitimately in flight.
    expect(WAIT_TIMEOUT_DEFAULT_MS).toBeLessThan(STALE_ACTIVE_MS)
  })

  // The screen ceiling has to leave room for several poll passes, or a healthy
  // daemon would start discarding its own current readings; and it has to be
  // shorter than a default wait, or the ceiling could never bite within one.
  it("the screen-reading ceiling spans several default poll intervals", () => {
    // `PID_TERMINAL_POLL_MS`'s default, which lives in the daemon's config funnel
    // (platform/config.io.ts) — a workspace `shared/` must not import, so the
    // relationship is asserted against the literal it is chosen from.
    const DEFAULT_POLL_MS = 15_000
    expect(SCREEN_READING_MAX_AGE_MS).toBeGreaterThanOrEqual(4 * DEFAULT_POLL_MS)
  })

  // A screen reading must not stay trustworthy for longer than the supervisor's
  // own report does. `state.json` untouched for STALE_ACTIVE_MS is reported as
  // stale; a pane nobody has re-read for longer than that cannot be the fresher
  // of the two observations, which is the entire argument for consulting it.
  it("a screen reading goes stale no later than a session's own state does", () => {
    expect(SCREEN_READING_MAX_AGE_MS).toBeLessThanOrEqual(STALE_ACTIVE_MS)
  })

  it("every constant is a positive whole number of milliseconds", () => {
    for (const ms of [
      WAIT_TIMEOUT_MAX_MS,
      WAIT_TIMEOUT_DEFAULT_MS,
      STALE_ACTIVE_MS,
      SCREEN_READING_MAX_AGE_MS,
    ]) {
      expect(Number.isInteger(ms)).toBe(true)
      expect(ms).toBeGreaterThan(0)
    }
  })
})
