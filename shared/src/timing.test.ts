import { describe, expect, it } from "bun:test"
import { STALE_ACTIVE_MS, WAIT_TIMEOUT_DEFAULT_MS, WAIT_TIMEOUT_MAX_MS } from "./timing"

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

  it("every constant is a positive whole number of milliseconds", () => {
    for (const ms of [WAIT_TIMEOUT_MAX_MS, WAIT_TIMEOUT_DEFAULT_MS, STALE_ACTIVE_MS]) {
      expect(Number.isInteger(ms)).toBe(true)
      expect(ms).toBeGreaterThan(0)
    }
  })
})
