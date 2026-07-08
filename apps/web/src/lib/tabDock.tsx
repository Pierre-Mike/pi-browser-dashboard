import type { ReactNode } from "react"

// Shared tab-dock design language for the app's primary navigation. The root
// dashboard and the per-project page both render a horizontal "dock" of
// icon+label tabs; centralising the look here keeps the two surfaces identical
// and lets the styling be unit-tested without a renderer.

// A 16px stroked SVG that inherits `currentColor` — no icon font / extra dep.
// Module-private: callers consume the pre-built TAB_ICONS / EXT_ICON values.
const Icon = ({ d }: { d: string }) => (
  <svg
    viewBox="0 0 24 24"
    width="16"
    height="16"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    className="shrink-0"
  >
    <path d={d} />
  </svg>
)

// Icons keyed by the semantic section name. Both the root dashboard and the
// project page map their tab keys onto these so a "Terminal" tab looks the same
// everywhere.
export const TAB_ICONS: Record<string, ReactNode> = {
  terminal: <Icon d="M4 17l6-5-6-5M12 19h8" />,
  orchestration: (
    <Icon d="M12 3v3m0 12v3m9-9h-3M6 12H3m13.5-6.5L14.5 8m-5 8L7.5 18m9 0L14.5 16m-5-8L7.5 6M12 9a3 3 0 100 6 3 3 0 000-6z" />
  ),
  activity: <Icon d="M3 12h4l3 8 4-16 3 8h4" />,
  claude: <Icon d="M12 2l2.4 6.5L21 11l-6.6 2.5L12 20l-2.4-6.5L3 11l6.6-2.5z" />,
  library: (
    <Icon d="M4 19.5A2.5 2.5 0 016.5 17H20M4 19.5A2.5 2.5 0 006.5 22H20V2H6.5A2.5 2.5 0 004 4.5v15z" />
  ),
  extensions: (
    <Icon d="M14 7h3a2 2 0 012 2v3m-5-5V5a2 2 0 00-2-2H9a2 2 0 00-2 2v2H5a2 2 0 00-2 2v3h2.5a2 2 0 110 4H3v3a2 2 0 002 2h3v-2.5a2 2 0 114 0V21h3a2 2 0 002-2v-3" />
  ),
  tunnel: (
    <Icon d="M12 3C7 3 3 6 3 9v9a3 3 0 003 3h12a3 3 0 003-3V9c0-3-4-6-9-6zm-4 9h.01M16 12h.01M9 18h6" />
  ),
  github: (
    <Icon d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 00-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0019.5 4.5a5.07 5.07 0 00-.09-3.77S17.73.35 14 2.48a13.38 13.38 0 00-7 0C3.27.35 1.59.73 1.59.73A5.07 5.07 0 001.5 4.5 5.44 5.44 0 000 8.55c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 005.5 18.13V22" />
  ),
  files: <Icon d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />,
  settings: (
    <Icon d="M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z" />
  ),
}

// Generic icon for extension-contributed tabs / panels (puzzle piece).
export const EXT_ICON = TAB_ICONS.extensions

// Icon for the per-project Brainstorm tab and its boards (a lightbulb — these
// are free-form drawing canvases with AI companions).
export const BRAINSTORM_ICON = (
  <Icon d="M9 18h6M10 21h4M12 3a6 6 0 00-3.5 10.9c.9.7 1.5 1.7 1.5 2.8V17h4v-.3c0-1.1.6-2.1 1.5-2.8A6 6 0 0012 3z" />
)

// Icon for per-project pid-app tabs (a document/page — these render dropped
// HTML such as specs and plans).
export const PIDAPP_ICON = (
  <Icon d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8zM14 2v6h6" />
)

// The dock container: a soft rounded bar that scrolls horizontally without a
// visible scrollbar. Same on every surface.
export const tabDockNavClass =
  "flex items-center gap-1 overflow-x-auto rounded-xl border border-base-300 bg-base-200/60 px-1.5 py-1.5 shadow-sm backdrop-blur [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"

// One tab button. Active = daisyUI primary fill with a lift; idle = muted,
// warming on hover.
export const tabButtonClass = (active: boolean): string =>
  [
    "group shrink-0 inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5",
    "text-xs font-medium transition-all duration-150",
    active
      ? "bg-primary text-primary-content shadow-sm shadow-primary/30"
      : "text-base-content/60 hover:bg-base-300/70 hover:text-base-content",
  ].join(" ")

// The vertical sub-tab rail: a fixed-width, scrollable column that sits to the
// LEFT of a parent tab's content (e.g. the Specs tab lists each dropped
// spec/app here). Same base-200 tint + rounding as the horizontal dock so the
// two navs read as one system.
export const subTabRailClass =
  "flex w-48 shrink-0 flex-col gap-1 overflow-y-auto rounded-xl border border-base-300 bg-base-200/60 p-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"

// One left-rail sub-tab. Full-width, left-aligned (a vertical list, not a
// centred pill) but reusing the dock's active/idle colour language.
export const subTabButtonClass = (active: boolean): string =>
  [
    "group inline-flex w-full items-center gap-1.5 truncate rounded-lg px-2.5 py-1.5 text-left",
    "text-xs font-medium transition-all duration-150",
    active
      ? "bg-primary text-primary-content shadow-sm shadow-primary/30"
      : "text-base-content/60 hover:bg-base-300/70 hover:text-base-content",
  ].join(" ")
