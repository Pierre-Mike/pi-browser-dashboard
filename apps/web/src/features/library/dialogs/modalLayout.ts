// Class token for the library Modal panel, kept pure so the contrast
// invariant is unit-testable (same pattern as spawnModalLayout).

// The native <dialog> host gets `color: canvastext` (black) from the UA
// stylesheet, so the panel must carry an explicit text colour — without one,
// a dark theme renders black-on-dark. `text-base-content` is that explicit
// colour and follows the theme, which a slate literal could not.
export const MODAL_PANEL =
  "absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-box border border-base-300 bg-base-100 text-base-content shadow-xl max-w-lg w-full mx-4 max-h-[80vh] overflow-auto"
