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

/**
 * Oldest screen reading a wait will satisfy itself from **up front**.
 *
 * A `via: screen` / `either` wait consults the daemon's stored classification
 * before it starts listening, so a pane already sitting at a prompt settles the
 * wait instead of hanging for a transition that happened before the request. The
 * catch is that a stored reading has an age, and until this constant existed the
 * initial check ignored it completely: on a daemon whose poller is off (or whose
 * timers have died — this one has lost every `setInterval` on a long uptime
 * before) the wait would answer `reached "idle" via screen` from a record nobody
 * had refreshed since boot. An agent that blocks on the screen and is handed a
 * two-hour-old answer is worse off than one that timed out, because it proceeds.
 *
 * 60s is four times the default poll interval (`PID_TERMINAL_POLL_MS`, 15s), so a
 * healthy daemon — or any terminal a browser is attached to, which the WS
 * classifier tap keeps current independently of the poller — never trips it,
 * while the measured failure (a 105-minute-old reading) trips it by two orders of
 * magnitude. It is deliberately NOT derived from the configured interval: a
 * daemon polling every 5 minutes should not thereby be allowed to call a
 * 5-minute-old reading fresh.
 *
 * This bounds only the reading a wait STARTS from. A classification that arrives
 * on the bus while the wait is listening is fresh by construction — it was
 * published the moment the screen changed — and no ceiling is applied to it.
 */
export const SCREEN_READING_MAX_AGE_MS = 60_000
