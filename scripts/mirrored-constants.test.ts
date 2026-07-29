import { describe, expect, it } from "bun:test"
import { SCREEN_AGREES_WITH } from "../apps/daemon/src/features/sessions/sessions-explain.core"
// The web chip's own copy of the screen-agreement table, tuned against the
// live daemon — see the suite below.
import { AGREES_WITH as WEB_AGREES_WITH } from "../apps/web/src/features/terminal/terminalState"

/**
 * Guards vocabulary that still exists as a hand-written *copy* in two places.
 * This file lives under `scripts/`, not `features/<slice>/`, so axiom-debt's
 * `sliceOf()` returns null for it and the cross-boundary imports above add zero
 * debt — it exists purely to catch a copy drifting from what it copies.
 *
 * It used to guard four more: the session-state slugs (copied into
 * `features/fleet`, `features/rules` and the CLI's agent core), the named-key
 * list (`features/rules`), and the wait/staleness timings. Those copies existed
 * because a pure core may not import another slice's internals, so no side could
 * hold the single declaration. `shared/src/{session,keys,timing}.ts` now does —
 * a `shared/` contract is importable from a pure core at zero debt — and the
 * copies, along with their assertions here, are gone.
 *
 * **The table below is the next candidate for the same treatment.** Its own
 * comment names the exact constraint `shared/` removes: "apps/web cannot import
 * apps/daemon's slice internals and the daemon must not import the web app, so
 * neither side can hold the single copy." A `shared/` contract can. It is left
 * as a mirror here only because the table was tuned against the live daemon very
 * recently (PRs #433–#447), and moving hot code during a merge is the wrong
 * moment to do it.
 */

/**
 * The screen-vs-supervisor agreement table exists twice: the web app decides
 * whether a session card spends space on a terminal chip, and
 * GET /sessions/:id/explain decides whether to say the screen contradicts the
 * supervisor. They are the same judgement and were tuned together against the
 * live daemon (a resting pane confirms every not-running state — see PRs #433
 * and #435), so a change to one that misses the other would put a chip on a
 * card explain calls consistent, or vice versa.
 *
 * apps/web cannot import apps/daemon's slice internals and the daemon must not
 * import the web app, so neither side can hold the single copy. This file can
 * import both without adding cross-slice debt (axiom-debt's sliceOf() returns
 * null for scripts/), which is exactly what it is for.
 */
describe("the screen-agreement table mirrored between the web chip and explain", () => {
  it("agrees key for key with apps/web's AGREES_WITH", () => {
    expect(SCREEN_AGREES_WITH).toEqual(WEB_AGREES_WITH)
  })

  // Not a tautology over the mirror above: these are the two rows the live
  // tuning turned on, so they get named assertions that survive a careless
  // "simplify the table" edit to both copies at once.
  it("keeps a resting screen agreeing with every not-running supervisor state", () => {
    expect([...(SCREEN_AGREES_WITH.idle ?? [])].sort()).toEqual([
      "done",
      "failed",
      "idle",
      "stopped",
    ])
  })

  it("keeps blocked and needs_input as one condition", () => {
    expect([...(SCREEN_AGREES_WITH.blocked ?? [])].sort()).toEqual(["blocked", "needs_input"])
  })

  // The absence of a matcher is the absence of evidence: `unknown` agrees with
  // nothing, which both copies spell as an empty row, and which both therefore
  // must read as "asserts nothing" rather than "contradicts everything".
  it("leaves the unknown classification asserting nothing in either copy", () => {
    expect(SCREEN_AGREES_WITH.unknown).toEqual([])
    expect(WEB_AGREES_WITH.unknown).toEqual([])
  })
})
