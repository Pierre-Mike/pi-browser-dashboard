// Class token for the library Modal panel, kept pure so the contrast
// invariant is unit-testable (same pattern as spawnModalLayout).

// The native <dialog> host gets `color: canvastext` (black) from the UA
// stylesheet, so the panel must carry explicit light/dark text colors —
// without them dark mode renders black-on-dark.
export const MODAL_PANEL =
  "absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xl max-w-lg w-full mx-4 max-h-[80vh] overflow-auto"
