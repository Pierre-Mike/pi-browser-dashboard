import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
// The minting side of the zellij-name agreement checked at the bottom of this file.
import { piDispatchSessionName } from "../apps/daemon/src/features/dispatch/pi.io"
import { SCREEN_AGREES_WITH } from "../apps/daemon/src/features/sessions/sessions-explain.core"
// The resolving side: what the attach path and the screen poller both compose.
import {
  piZellijSessionName,
  prefixedZellijSession,
} from "../apps/daemon/src/features/terminal/terminal.core"
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

/**
 * Not a mirrored *constant* but the same failure mode, and the same reason this
 * file is where it can be checked: one slice MINTS a zellij session name and
 * another RESOLVES it, neither may import the other's internals, so neither side
 * could hold an assertion that the two agree.
 *
 * They didn't. `features/dispatch/pi.io.ts` created a dispatched pi run as a bare
 * `pi-<short>` while both readers in `features/terminal/terminal.routes.ts` — the
 * attach path (`resolvePiSession`) and the screen poller (`sessionPollCandidates`)
 * — ran that name through `prefixedZellijSession`. With `PID_ZELLIJ_PREFIX` set,
 * the dispatch created a session neither could address, and all three of attach,
 * poll and kill broke silently (see `piDispatchSessionName`'s comment for the
 * observed symptoms, including attach resurrecting a second pi on the same
 * session id).
 *
 * Asserted as a property over several prefixes rather than one literal, because
 * `prefixedZellijSession` has real behaviour to agree with — sanitizing, a length
 * cap, and returning the bare name for an empty prefix.
 */
describe("the zellij session name a dispatched pi run is created under", () => {
  const PREFIXES = ["", "polltest", "e2e", "second-checkout", "weird.prefix_v2", "a".repeat(80)]

  it("is exactly what the attach path and the poller resolve, for every prefix", () => {
    for (const prefix of PREFIXES) {
      expect(piDispatchSessionName({ short: "bd83d0a7", prefix })).toBe(
        prefixedZellijSession({ prefix, name: piZellijSessionName("bd83d0a7") }),
      )
    }
  })

  // The regression that mattered: with a prefix configured, the created name must
  // not be the bare one. Without this, the assertion above would still pass if
  // BOTH sides dropped the prefix.
  it("carries the prefix rather than the bare name whenever one is configured", () => {
    const withPrefix = piDispatchSessionName({ short: "bd83d0a7", prefix: "polltest" })
    expect(withPrefix).toBe("polltest-pi-bd83d0a7")
    expect(withPrefix).not.toBe(piZellijSessionName("bd83d0a7"))
  })

  // ...and the empty prefix every default daemon runs with must still produce the
  // byte-identical legacy name, so the fix cannot orphan a running session.
  it("is unchanged from the legacy name when no prefix is configured", () => {
    expect(piDispatchSessionName({ short: "bd83d0a7", prefix: "" })).toBe("pi-bd83d0a7")
  })

  // The three assertions above test the helper. The BUG was at the call site:
  // `dispatch` reached past a helper like this one straight to the unprefixed
  // `piZellijSessionName`. Testing the helper alone would let exactly that
  // regression back in, so this pins the mint site too — pi.io.ts may derive a
  // pi session name in exactly one place, and everything else must go through
  // it. Source-shape assertions are the established guard here (see
  // scripts/check-harness.ts), because the alternative is stubbing a subprocess
  // spawn to observe one string.
  it("is derived in exactly one place in pi.io.ts — the call site cannot bypass it", () => {
    const src = readFileSync(
      join(import.meta.dir, "..", "apps/daemon/src/features/dispatch/pi.io.ts"),
      "utf8",
    )
    const rawMints = [...src.matchAll(/piZellijSessionName\(/g)]
    expect(rawMints).toHaveLength(1)
    // ...and that one occurrence is the helper's own body, not a call site.
    const helperBody = src.slice(src.indexOf("export const piDispatchSessionName"))
    expect(helperBody).toContain("piZellijSessionName(")
    // The dispatch body names the session through the helper.
    expect(src).toContain("piDispatchSessionName({ short, prefix: zellijPrefix })")
  })
})
