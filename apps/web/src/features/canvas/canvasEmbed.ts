// Pure helpers for the file-node embed feature: detect what kind of embed a
// given path/URL deserves, and provide a small bridge for cross-canvas
// imports via a CustomEvent on `window`. The bridge is the only side-effecty
// piece here — the classifier is fully pure and unit-testable.

export type EmbedKind = "image" | "pdf" | "markdown" | "canvas" | "other"

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|avif|bmp|ico)(\?.*)?$/i
const PDF_EXT = /\.pdf(\?.*)?$/i
const MARKDOWN_EXT = /\.md(\?.*)?$/i
const CANVAS_EXT = /\.canvas(\?.*)?$/i

/**
 * Classify a file reference by its extension. The result drives the file
 * node's inline preview: image -> <img>, pdf -> <embed>, markdown -> fetched
 * + rendered with our markdown helper, canvas -> "Open" button that imports
 * the file. Anything else falls back to a plain filename card.
 *
 * The path is interpreted as a URL the browser can fetch. http(s) URLs work
 * directly. Local paths (e.g. `~/notes/x.md`) won't load — they're shown as
 * a reference only, which matches Obsidian's behavior outside a vault.
 */
export const classifyEmbed = (ref: string): EmbedKind => {
  const trimmed = ref.trim()
  if (CANVAS_EXT.test(trimmed)) return "canvas"
  if (IMAGE_EXT.test(trimmed)) return "image"
  if (PDF_EXT.test(trimmed)) return "pdf"
  if (MARKDOWN_EXT.test(trimmed)) return "markdown"
  return "other"
}

/**
 * Whether the browser can directly fetch the given reference. Local paths
 * (anything not starting with http(s)://, /, ./ or data:) we treat as
 * non-loadable so the preview falls back to "filename only".
 */
export const isLoadable = (ref: string): boolean => {
  const trimmed = ref.trim()
  if (!trimmed) return false
  return /^(https?:\/\/|\/|\.\/|data:)/i.test(trimmed)
}

// --- Cross-canvas import bridge ---------------------------------------------
//
// File nodes don't have direct access to the canvas-level setNodes/setEdges,
// and dragging context all the way down adds coupling. Instead we use a
// scoped CustomEvent — the file node dispatches `canvas:import` with the
// fetched .canvas text, and CanvasTab subscribes to it. This keeps the file
// node decoupled and trivially testable.

export const CANVAS_IMPORT_EVENT = "canvas:import"

export type CanvasImportDetail = { readonly text: string; readonly source: string }

export const dispatchCanvasImport = (text: string, source: string): void => {
  try {
    window.dispatchEvent(
      new CustomEvent<CanvasImportDetail>(CANVAS_IMPORT_EVENT, { detail: { text, source } }),
    )
  } catch {
    // Browser without CustomEvent support — silent fallback. We don't have a
    // sensible alternative path here.
  }
}
