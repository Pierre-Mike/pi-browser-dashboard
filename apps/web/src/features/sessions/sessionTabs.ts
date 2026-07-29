import { BOARD_TAB_PREFIX } from "../brainstorms/brainstorms"

// The session drill-in's sections, in dock order. Terminal leads because it is
// the drill-in's default tab — the same Terminal-leading shape the project
// dashboard's dock uses, so the two surfaces open on the same section.
export const SESSION_TAB_DOCK = [
  { key: "terminal", label: "Terminal" },
  { key: "chat", label: "Chat" },
  // Every drawing in this session's worktree; individual boards live in the
  // section's left rail rather than each claiming a dock tab. This is the only
  // drawing section — the old Canvas tab edited one scratch file per job dir,
  // which a board in the worktree already covers, and better: it is a real file
  // the session's agent can see.
  { key: "brainstorm", label: "Brainstorm" },
  { key: "files", label: "Files" },
] as const

export type SessionTab = (typeof SESSION_TAB_DOCK)[number]["key"]

// A selected board is carried as `brainstorm:<encoded path>`, which implies the
// parent Brainstorm section — the same scheme the project page uses for
// `pidapp:<id>`. The encoding itself belongs to the brainstorms feature; this
// re-export is what the route's `?tab=` whitelist matches on.
export { BOARD_TAB_PREFIX }

// The `?tab=` whitelist, derived from the dock so a section can never be
// dockable-but-unroutable (or routable but missing from the dock).
export const SESSION_TABS: readonly SessionTab[] = SESSION_TAB_DOCK.map((t) => t.key)

/**
 * Which dock button lights up for a `?tab=` value. A parent section stays lit
 * while one of its children is selected, so deep-linking a board does not leave
 * the dock looking like nothing is active.
 */
export const isSessionTabActive = (input: {
  readonly tab: string
  readonly key: SessionTab
}): boolean =>
  input.key === "brainstorm"
    ? input.tab === "brainstorm" || input.tab.startsWith(BOARD_TAB_PREFIX)
    : input.tab === input.key

/** The section a `?tab=` value renders — a board key resolves to Brainstorm. */
export const sessionSectionFor = (tab: string): SessionTab =>
  tab.startsWith(BOARD_TAB_PREFIX) ? "brainstorm" : (tab as SessionTab)
