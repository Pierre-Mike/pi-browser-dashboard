import { describe, expect, it } from "bun:test"
// fleet.core.ts's own literal copies (features/fleet/ cannot import
// features/sessions/ internals without adding a NEW cross-slice-import
// violation — `bun run axiom-debt` fails on any diff from its baseline).
import {
  SESSION_STATE_SLUGS,
  WAIT_TIMEOUT_MAX_MS,
} from "../apps/daemon/src/features/fleet/fleet.core"
// fleet-run.core.ts's own literal copy of the wait primitive's default
// timeout, for the same reason (see that file's header comment).
import { WAIT_TIMEOUT_DEFAULT_MS } from "../apps/daemon/src/features/fleet/fleet-run.core"
// rules.core.ts's own literal copies — same constraint, see that file's own
// "Mirrored vocabulary" header comment.
import {
  NAMED_KEYS as RULES_NAMED_KEYS,
  SESSION_STATE_SLUGS as RULES_SESSION_STATE_SLUGS,
  STALE_ACTIVE_MS as RULES_STALE_ACTIVE_MS,
} from "../apps/daemon/src/features/rules/rules.core"
import { KNOWN_STATES } from "../apps/daemon/src/features/sessions/sessions.core"
// The real values fleet.core.ts / fleet-run.core.ts / rules.core.ts cannot
// import (see below).
import { STALE_ACTIVE_MS } from "../apps/daemon/src/features/sessions/sessions-explain.core"
import { NAMED_KEYS } from "../apps/daemon/src/features/sessions/sessions-keys.core"
import {
  WAIT_TIMEOUT_DEFAULT_MS as REAL_WAIT_TIMEOUT_DEFAULT_MS,
  WAIT_TIMEOUT_MAX_MS as REAL_WAIT_TIMEOUT_MAX_MS,
} from "../apps/daemon/src/features/sessions/sessions-wait.core"

/**
 * Guards the mirrored vocabulary fleet.core.ts / fleet-run.core.ts keep as
 * literal copies instead of importing (see those files' own comments for why,
 * and apps/cli/src/agent/agent.core.ts for the identical precedent this repo
 * already established). This file lives under scripts/, not features/<slice>/,
 * so axiom-debt's sliceOf() returns null for it and the cross-slice import
 * above adds zero debt — it exists purely to catch the mirror drifting from
 * the source it copies.
 */
describe("fleet.core's mirrored session-state / wait-timeout constants", () => {
  it("SESSION_STATE_SLUGS matches sessions.core's KNOWN_STATES exactly", () => {
    expect(SESSION_STATE_SLUGS).toEqual(KNOWN_STATES)
  })

  it("WAIT_TIMEOUT_MAX_MS matches sessions-wait.core's WAIT_TIMEOUT_MAX_MS", () => {
    expect(WAIT_TIMEOUT_MAX_MS).toBe(REAL_WAIT_TIMEOUT_MAX_MS)
  })
})

describe("fleet-run.core's mirrored wait-timeout default", () => {
  it("WAIT_TIMEOUT_DEFAULT_MS matches sessions-wait.core's WAIT_TIMEOUT_DEFAULT_MS", () => {
    expect(WAIT_TIMEOUT_DEFAULT_MS).toBe(REAL_WAIT_TIMEOUT_DEFAULT_MS)
  })
})

describe("rules.core's mirrored session-state / named-key / staleness constants", () => {
  it("SESSION_STATE_SLUGS matches sessions.core's KNOWN_STATES exactly", () => {
    expect(RULES_SESSION_STATE_SLUGS).toEqual(KNOWN_STATES)
  })

  it("NAMED_KEYS matches sessions-keys.core's NAMED_KEYS exactly", () => {
    // Real NAMED_KEYS (sessions-keys.core.ts) is `ReadonlyArray<NamedKey>`
    // (built from `Object.keys(...)` at runtime), not a literal tuple like
    // this mirror — expect() the wider-typed real value first so `toEqual`'s
    // generic doesn't pin T to the narrower tuple type.
    expect(NAMED_KEYS).toEqual(RULES_NAMED_KEYS)
  })

  it("STALE_ACTIVE_MS matches sessions-explain.core's STALE_ACTIVE_MS", () => {
    expect(RULES_STALE_ACTIVE_MS).toBe(STALE_ACTIVE_MS)
  })
})
