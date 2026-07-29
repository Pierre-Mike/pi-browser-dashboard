/**
 * Protocol timing constants.
 *
 * These are part of the contract, not implementation details: a client picks a
 * `?timeout=` for `GET /sessions/:id/wait` against `WAIT_TIMEOUT_MAX_MS`, gets
 * `WAIT_TIMEOUT_DEFAULT_MS` when it omits one, and reads a session's staleness
 * badge against `STALE_ACTIVE_MS`.
 *
 * All three were previously declared twice — the real value in
 * `features/sessions/`, and a hand-written literal copy in `features/fleet/` or
 * `features/rules/`, because importing across slices is debt the ratchet blocks.
 * A drift guard (`scripts/mirrored-constants.test.ts`) existed purely to compare
 * the copies. One declaration here retires both the copies and the guard.
 */

/** Longest `?timeout=` a wait request may ask for. */
export const WAIT_TIMEOUT_MAX_MS = 600_000

/** Applied when a wait request omits `?timeout=`. */
export const WAIT_TIMEOUT_DEFAULT_MS = 30_000

/** How long a session may sit in an active state before it reads as stale. */
export const STALE_ACTIVE_MS = 120_000
