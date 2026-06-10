// Layout class tokens for the SpawnModal, kept pure so the sizing invariants
// (wide enough + tall enough to show every skill) are unit-testable without a
// DOM render harness.

// Modal shell: wide enough to fit many skill pills per row before wrapping.
// Carries explicit text colors because the modal portals into document.body,
// outside the themed root div — without them dark mode renders black-on-dark.
export const SPAWN_MODAL_SHELL =
  "w-full max-w-3xl rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-2xl p-4 flex flex-col gap-3"

// Skills container: grows with the viewport so all skills are visible, only
// scrolling when the list genuinely overflows the screen.
export const SPAWN_SKILLS_CONTAINER = "flex flex-wrap gap-1.5 max-h-[60vh] overflow-y-auto"

// Intent textarea: explicit text + placeholder colors so typed text stays
// readable on the near-black dark background (the portal escapes the themed
// root, so nothing useful is inherited).
export const SPAWN_INTENT_INPUT =
  "w-full resize-none rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
