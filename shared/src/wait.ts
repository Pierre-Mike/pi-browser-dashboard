/**
 * The wait contract — which observation of a session may settle a wait, and
 * what counts as a match when the condition is text on the screen.
 *
 * Both vocabularies are things a caller writes into a request body for
 * `POST /sessions/:id/wait` (or the nested `wait` object on send/keys), which
 * makes them contracts rather than implementation details. Two workspaces
 * validate against them from opposite ends: `apps/daemon` parses an untrusted
 * body, and `apps/cli` rejects a bad `--via` / `--anchor` as a usage error
 * *before* making a request, so a mistake costs an exit code instead of a
 * round-trip. Declared once here so the two ends cannot hold different opinions
 * about what is valid — the drift this workspace exists to delete.
 */

/**
 * Which reading of a session is allowed to satisfy a wait.
 *
 * A session has two independent readings and they disagree in exactly the case
 * that matters: `state.json` is what the supervisor last wrote, while the
 * terminal classification is what the pane actually shows. One real session sat
 * at `working` in `state.json` for 24 hours while its screen showed an empty
 * prompt — no supervisor-sourced wait could ever have noticed.
 *
 * - `supervisor` — `session.state` only.
 * - `screen` — the terminal classifier only.
 * - `either` — whichever arrives first; the outcome says which one did.
 */
export const WAIT_VIA_VALUES = ["supervisor", "screen", "either"] as const

export type WaitVia = (typeof WAIT_VIA_VALUES)[number]

export const isWaitVia = (value: unknown): value is WaitVia =>
  typeof value === "string" && (WAIT_VIA_VALUES as readonly string[]).includes(value)

/**
 * Applied when a request omits `via`, so every caller written before the screen
 * became a wait source keeps precisely the semantics it was written against.
 */
export const DEFAULT_WAIT_VIA: WaitVia = "supervisor"

/**
 * Which observation actually settled a satisfied wait. A strict subset of
 * `WaitVia`: `"either"` is a request, never an answer.
 */
export const WAIT_SATISFIED_VIA_VALUES = ["supervisor", "screen"] as const

export type WaitSatisfiedVia = (typeof WAIT_SATISFIED_VIA_VALUES)[number]

export const isWaitSatisfiedVia = (value: unknown): value is WaitSatisfiedVia =>
  typeof value === "string" && (WAIT_SATISFIED_VIA_VALUES as readonly string[]).includes(value)

/**
 * Where an output pattern has to sit on the line. Anchored forms compare
 * against the **trimmed** line, because a real screen dump right-pads rows to
 * the viewport width and pads an empty prompt line with U+00A0 — anchoring to
 * the raw line would never fire on live output.
 */
export const OUTPUT_ANCHORS = ["anywhere", "line-start", "line-end", "line"] as const

export type OutputAnchor = (typeof OUTPUT_ANCHORS)[number]

export const isOutputAnchor = (value: unknown): value is OutputAnchor =>
  typeof value === "string" && (OUTPUT_ANCHORS as readonly string[]).includes(value)

/** Applied when a pattern names no anchor: match the substring anywhere. */
export const DEFAULT_OUTPUT_ANCHOR: OutputAnchor = "anywhere"

/**
 * Longest output pattern accepted.
 *
 * The cap is load-bearing, not cosmetic. A pattern is attacker-adjacent input
 * on an unauthenticated local endpoint, matched inside the daemon's own event
 * path against a screenful of terminal output, which is why the pattern is a
 * literal substring and never a regex: compiling a caller's regex once bounds
 * the compile, not the backtracking, and JS offers no way to time-bound a match.
 * A capped literal cannot backtrack at all.
 */
export const OUTPUT_PATTERN_MAX_CHARS = 200

/**
 * A parsed pattern. On the wire a caller may also send the shorthand — a bare
 * string, meaning this text anywhere — which both ends normalize into this
 * shape with `DEFAULT_OUTPUT_ANCHOR`.
 */
export type OutputPattern = {
  readonly text: string
  readonly anchor: OutputAnchor
}
