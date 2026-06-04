// Layout class tokens for the SpawnModal, kept pure so the sizing invariants
// (wide enough + tall enough to show every skill) are unit-testable without a
// DOM render harness.

// Modal shell: wide enough to fit many skill pills per row before wrapping.
export const SPAWN_MODAL_SHELL =
  "w-full max-w-3xl rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl p-4 flex flex-col gap-3"

// Skills container: grows with the viewport so all skills are visible, only
// scrolling when the list genuinely overflows the screen.
export const SPAWN_SKILLS_CONTAINER = "flex flex-wrap gap-1.5 max-h-[60vh] overflow-y-auto"
