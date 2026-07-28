// The session drill-in's sections, in dock order. Terminal leads because it is
// the drill-in's default tab — the same Terminal-leading shape the project
// dashboard's dock uses, so the two surfaces open on the same section.
export const SESSION_TAB_DOCK = [
  { key: "terminal", label: "Terminal" },
  { key: "chat", label: "Chat" },
  { key: "canvas", label: "Canvas" },
  { key: "files", label: "Files" },
] as const

export type SessionTab = (typeof SESSION_TAB_DOCK)[number]["key"]

// The `?tab=` whitelist, derived from the dock so a section can never be
// dockable-but-unroutable (or routable but missing from the dock).
export const SESSION_TABS: readonly SessionTab[] = SESSION_TAB_DOCK.map((t) => t.key)
