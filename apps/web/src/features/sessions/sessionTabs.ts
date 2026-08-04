import { BOARD_TAB_PREFIX } from "../brainstorms/brainstorms"

/**
 * The session drill-in is a **split**, not a set of tabs: the terminal is always
 * mounted on the left and ONE optional section docks to its right, resizable.
 *
 * So this dock lists only what can occupy that right pane. Terminal is absent
 * because it is the surface itself — a "Terminal" tab would imply it can be
 * switched away from, and the pty attach it holds is the one thing this layout
 * exists to keep alive across every section change. Chat is absent because it is
 * deleted: a transcript pane beside a live pty rendered the same turns twice,
 * and its composer duplicated the terminal's own input line.
 */
export const SESSION_TAB_DOCK = [
  // Every drawing in this session's worktree; individual boards live in the
  // section's left rail rather than each claiming a dock tab. This is the only
  // drawing section — the old Canvas tab edited one scratch file per job dir,
  // which a board in the worktree already covers, and better: it is a real file
  // the session's agent can see.
  { key: "brainstorm", label: "Brainstorm" },
  { key: "files", label: "Files" },
] as const

/** A section that can occupy the resizable right pane. */
export type SessionPane = (typeof SESSION_TAB_DOCK)[number]["key"]

/**
 * The `?tab=` value meaning "no side pane — terminal only". Routable but not
 * dockable: every link minted before the split existed says `?tab=terminal`, and
 * under the split that reads as the terminal at full width, which is exactly
 * what those links used to show.
 */
export const TERMINAL_ONLY_TAB = "terminal"

export type SessionTab = SessionPane | typeof TERMINAL_ONLY_TAB

// A selected board is carried as `brainstorm:<encoded path>`, which implies the
// parent Brainstorm section — the same scheme the project page uses for
// `pidapp:<id>`. The encoding itself belongs to the brainstorms feature; this
// re-export is what the route's `?tab=` whitelist matches on.
export { BOARD_TAB_PREFIX }

/**
 * The `?tab=` whitelist: the terminal-only value plus every docked section, so a
 * section can never be dockable-but-unroutable (or routable but missing from the
 * dock). Derived from the dock rather than typed out twice.
 */
export const SESSION_TABS: readonly SessionTab[] = [
  TERMINAL_ONLY_TAB,
  ...SESSION_TAB_DOCK.map((t) => t.key),
]

const DOCKED_KEYS: readonly SessionPane[] = SESSION_TAB_DOCK.map((t) => t.key)

/**
 * Which dock button lights up for a `?tab=` value. A parent section stays lit
 * while one of its children is selected, so deep-linking a board does not leave
 * the dock looking like nothing is active. Nothing is lit on the terminal-only
 * tab, because nothing is docked.
 */
export const isSessionTabActive = (input: {
  readonly tab: string
  readonly key: SessionPane
}): boolean =>
  input.key === "brainstorm"
    ? input.tab === "brainstorm" || input.tab.startsWith(BOARD_TAB_PREFIX)
    : input.tab === input.key

/**
 * Which section fills the right pane for a `?tab=` value — `null` for the
 * terminal alone. Total on purpose: an unknown or stale value opens no pane
 * rather than an empty bordered box beside the terminal.
 */
export const sessionPaneFor = (tab: string): SessionPane | null =>
  DOCKED_KEYS.find((key) => isSessionTabActive({ tab, key })) ?? null

/**
 * The `?tab=` a dock click lands on. Clicking the lit section closes the pane —
 * the only way back to a full-width terminal, so it has to be the same button
 * that opened it rather than a separate close affordance in the pane's corner.
 */
export const toggleSessionTab = (input: {
  readonly tab: string
  readonly key: SessionPane
}): SessionTab => (isSessionTabActive(input) ? TERMINAL_ONLY_TAB : input.key)
