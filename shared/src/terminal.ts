/**
 * The screen-classification contract — what the daemon reports about a terminal
 * it read, as opposed to what a session's supervisor claims about itself.
 *
 * Both vocabularies below already cross the wire: the `terminal.state` SSE event
 * and `GET /terminal/states` carry `{ scope, id, state, matcher, evidence, at }`,
 * and `GET /sessions/:id/explain` embeds the same reading as `terminal`. What
 * makes them *contracts* rather than internals is that a caller now writes them
 * INTO a request too — a screen-triggered rule in
 * `<claudeConfigDir>/pid-dashboard/rules.json` names both the state it waits for
 * and (optionally) the matcher it wants, so `features/rules` has to validate
 * against the same list `features/terminal` classifies with.
 *
 * That is exactly the constraint `shared/` exists to remove. A pure
 * `*.core.ts` may not import another slice's internals (`bun run axiom-debt`
 * fails the build on a new cross-slice reach), so before this file the rules
 * slice's only option was a hand-copied list behind a drift guard in
 * `scripts/mirrored-constants.test.ts` — the pattern that let `SessionState`
 * drift in the first place. A `shared/` contract is importable from any pure core
 * at zero debt, so one declaration serves both slices.
 *
 * Deliberately NOT here: the matcher *patterns*, and the order they are tried
 * in. Those are `apps/daemon/src/features/terminal/terminal-state.core.ts`'s
 * own business — a regex tuned against a live screen dump is an implementation
 * detail, and the ordering is a priority decision documented row by row in that
 * file. This is the name vocabulary only.
 */

/**
 * What a screen can be read as. A strict subset of the session-state vocabulary
 * in `./session.ts`, and the difference is the point: a classifier looking at a
 * pane cannot tell `done` from `failed` from `stopped` — all three sit at a
 * resting prompt — so it never claims to.
 *
 * `unknown` means "no matcher fired", i.e. the absence of evidence. It is a
 * classification the daemon publishes honestly rather than a state it guessed
 * at, and consumers must read it as "this screen asserts nothing", never as
 * "this screen contradicts everything".
 */
export const TERMINAL_STATE_SLUGS = ["working", "blocked", "idle", "unknown"] as const

export type TerminalStateSlug = (typeof TERMINAL_STATE_SLUGS)[number]

export const isTerminalStateSlug = (value: unknown): value is TerminalStateSlug =>
  typeof value === "string" && (TERMINAL_STATE_SLUGS as readonly string[]).includes(value)

/**
 * Which classifier row fired — the `matcher` field on every classification the
 * daemon publishes.
 *
 * A state alone is too coarse for automation: `blocked` covers a tool-permission
 * dialog AND a folder-trust dialog, and those want different answers (different
 * keystrokes, and a human may be happy to automate one and not the other). Naming
 * the matcher is how a rule says which dialog it means.
 *
 * The set is closed on purpose. A rules file naming a matcher this build does not
 * have is a validation error, not a rule that silently never fires — a typo in a
 * 3am pager rule should fail loudly at parse time.
 */
export const TERMINAL_MATCHER_NAMES = [
  "permission-prompt",
  "permission-prompt-reject-option",
  "workspace-trust-prompt",
  "tool-call-waiting",
  "thinking-gerund",
  "pi-working",
  "turn-complete",
  "prompt-resting",
] as const

export type TerminalMatcherName = (typeof TERMINAL_MATCHER_NAMES)[number]

export const isTerminalMatcherName = (value: unknown): value is TerminalMatcherName =>
  typeof value === "string" && (TERMINAL_MATCHER_NAMES as readonly string[]).includes(value)
