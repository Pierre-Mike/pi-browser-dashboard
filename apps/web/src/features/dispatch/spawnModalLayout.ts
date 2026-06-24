// Layout class tokens for the SpawnModal, kept pure so the sizing invariants
// (wide enough + tall enough to show every skill) are unit-testable without a
// DOM render harness.

// Modal shell: wide enough to fit many skill pills per row before wrapping.
// Carries explicit text colors because the modal portals into document.body,
// outside the themed root div — without them dark mode renders black-on-dark.
export const SPAWN_MODAL_SHELL =
  "w-full max-w-3xl rounded-xl border border-base-300 bg-base-100 text-base-content shadow-2xl p-4 flex flex-col gap-3"

// Skills container: a bordered panel that grows with the viewport so all skills
// are visible, scrolling vertically only when the list genuinely overflows the
// screen. overflow-x-hidden is load-bearing: overflow-y-auto alone promotes the
// x-axis from `visible` to `auto`, so a single un-shrinkable pill would draw a
// stray horizontal scrollbar. content-start keeps wrapped rows packed to the top.
export const SPAWN_SKILLS_CONTAINER =
  "flex flex-wrap content-start gap-1.5 max-h-[60vh] overflow-y-auto overflow-x-hidden rounded-lg border border-base-300 bg-base-200 p-2"

// Intent textarea: explicit text + placeholder colors so typed text stays
// readable on the near-black dark background (the portal escapes the themed
// root, so nothing useful is inherited).
export const SPAWN_INTENT_INPUT =
  "w-full resize-none rounded-md border border-base-300 bg-base-100 text-base-content placeholder:text-base-content/40 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-primary"

// Skill chip: a pill toggle for one skill. daisyUI's `.btn` ships
// flex-shrink:0 + flex-wrap:wrap, so a long unbroken id (e.g.
// /improve-codebase-architecture) can neither shrink nor wrap and overflows the
// row. `shrink`, `max-w-full`, `whitespace-normal`, and `break-all` undo that so
// long ids wrap inside the pill instead of forcing a horizontal scrollbar.
export const skillChipClass = (selected: boolean) =>
  `btn btn-xs h-auto min-h-0 max-w-full shrink whitespace-normal break-all gap-1 rounded-full px-2.5 py-1 text-left font-mono text-[11px] normal-case transition ${
    selected
      ? "btn-primary shadow-sm shadow-primary/30"
      : "btn-ghost border border-base-300 text-base-content/80 hover:border-base-300"
  }`
