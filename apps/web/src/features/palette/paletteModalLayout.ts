// Class tokens for the PaletteModal, kept pure so the contrast invariants are
// unit-testable without a DOM render harness (same pattern as spawnModalLayout).

// Modal shell: carries explicit text colors because the palette portals into
// document.body, outside the themed root div — without them dark mode renders
// black-on-dark.
export const PALETTE_MODAL_SHELL =
  "w-full max-w-lg rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-2xl flex flex-col overflow-hidden"

// Query input: transparent background over the shell, so it needs its own
// text + placeholder colors to stay readable in dark mode.
export const PALETTE_INPUT =
  "w-full px-4 py-3 text-sm bg-transparent text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 border-b border-slate-200 dark:border-slate-800 focus:outline-none"
