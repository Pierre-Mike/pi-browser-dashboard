// What the theme lab renders, as data.
//
// Reviewing a new family used to mean five views times two variants, eyeballed,
// and the thing that review kept missing is the reason this file exists: **five
// of the seven ink tokens only paint when a session has something to report.**
// `prism` shipped a first version that cleared every gate and was rejected on
// screenshot review because an idle dashboard showed exactly one hue —
// `success`/`warning`/`error`/`info` (and often `secondary`) were simply not on
// screen. A lab that puts the idle and the reporting states in two columns side
// by side makes that failure mechanical instead of a judgement call.
//
// Every class string here is a **literal**, and has to be: Tailwind scans source
// for class names, so a computed `bg-${token}` emits no CSS and the swatch renders
// transparent. That is also why this is a table rather than a loop over
// `REQUIRED_TOKENS`.
import { SESSION_STATE_SLUGS, type SessionStateSlug } from "@pid/shared"
import { stateColor } from "../../lib/format"

export type Swatch = {
  readonly token: string
  readonly surface: string
  readonly note: string
}

/**
 * The tokens the app paints as **surfaces**, in the order `tailwind.config.js`
 * declares them.
 *
 * Only `primary` gets its `*-content` shown, because `--color-primary-content` is
 * the one content token every theme declares (and the one with a gate on it:
 * 4.5:1 on `primary`). daisyUI derives the rest, so rendering
 * `text-secondary-content` here would put a *generated* value on review next to
 * eight designed ones.
 */
export const SURFACE_SWATCHES: readonly Swatch[] = [
  { token: "primary", surface: "bg-primary", note: "buttons, active tabs, focus" },
  { token: "secondary", surface: "bg-secondary", note: "second accent" },
  { token: "accent", surface: "bg-accent", note: "third accent" },
  { token: "neutral", surface: "bg-neutral", note: "inverted button" },
  { token: "info", surface: "bg-info", note: "working" },
  { token: "success", surface: "bg-success", note: "done" },
  { token: "warning", surface: "bg-warning", note: "blocked / needs input" },
  { token: "error", surface: "bg-error", note: "failed" },
  { token: "base-100", surface: "bg-base-100", note: "~75% of painted pixels" },
  { token: "base-200", surface: "bg-base-200", note: "cards, sidebar, hover" },
  { token: "base-300", surface: "bg-base-300", note: "every border on the page" },
]

/**
 * The same tokens as **ink** — the direction with the 4.5:1 floor on `base-100`.
 *
 * A token is legible in both directions or it is not legible: `primary` is a
 * surface under `primary-content` in a button and ink via `text-primary` in a
 * link, an active tab, a focus ring and a count pill. Showing only the swatches
 * would review half of each token.
 */
export const INK_SWATCHES: readonly { readonly token: string; readonly ink: string }[] = [
  { token: "primary", ink: "text-primary" },
  { token: "secondary", ink: "text-secondary" },
  { token: "accent", ink: "text-accent" },
  { token: "info", ink: "text-info" },
  { token: "success", ink: "text-success" },
  { token: "warning", ink: "text-warning" },
  { token: "error", ink: "text-error" },
]

/**
 * The three radius roles, each with what reads it.
 *
 * Shape is a theme property too — `terminal` is fully square, `neon` is the only
 * family whose controls are rounder than its panels — and a family's five-value
 * shape tuple has to be unique, so "is this visibly a different shape from the
 * last family?" is a review question with a gate behind it.
 */
export const RADIUS_ROLES: readonly {
  readonly role: string
  readonly cls: string
  readonly reads: string
}[] = [
  { role: "--radius-box", cls: "rounded-box", reads: "panels, cards, modals, code blocks" },
  { role: "--radius-field", cls: "rounded-btn", reads: "buttons, inputs, selects, tabs" },
  { role: "--radius-selector", cls: "rounded-badge", reads: "chips and pills" },
]

/**
 * Does this state paint a *status* token, or a base one?
 *
 * Derived from `stateColor` rather than listed, so the partition cannot drift
 * from the tones the sidebar actually uses — `idle`, `stopped` and `unknown` are
 * deliberately muted (`text-base-content/70`, `text-base-content`,
 * `text-base-content/50`), and everything else carries meaning in colour.
 */
export const isReportingState = (state: SessionStateSlug): boolean =>
  !stateColor(state).text.startsWith("text-base-content")

/** The five states that paint a hue — the ones an idle dashboard never shows. */
export const REPORTING_STATES: readonly SessionStateSlug[] =
  SESSION_STATE_SLUGS.filter(isReportingState)

/** The three that do not. This column is what a family looks like with nothing running. */
export const IDLE_STATES: readonly SessionStateSlug[] = SESSION_STATE_SLUGS.filter(
  (state) => !isReportingState(state),
)
