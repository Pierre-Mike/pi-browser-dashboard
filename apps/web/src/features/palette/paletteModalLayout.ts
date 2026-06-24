// Class tokens for the PaletteModal, kept pure so the contrast invariants are
// unit-testable without a DOM render harness (same pattern as spawnModalLayout).

// Modal shell: carries explicit text colors because the palette portals into
// document.body, outside the themed root div — without them dark mode renders
// black-on-dark.
export const PALETTE_MODAL_SHELL =
  "w-full max-w-lg rounded-xl border border-base-300 bg-base-100 text-base-content shadow-2xl flex flex-col overflow-hidden"

// Query input: transparent background over the shell, so it needs its own
// text + placeholder colors to stay readable in dark mode.
export const PALETTE_INPUT =
  "w-full px-4 py-3 text-sm bg-transparent text-base-content placeholder:text-base-content/40 border-b border-base-300 focus:outline-none"
