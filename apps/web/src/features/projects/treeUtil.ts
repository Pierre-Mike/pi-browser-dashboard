import type { FileTreeInitialExpansion } from "@pierre/trees"

// Directories start collapsed. Some repos hold thousands of files, and
// auto-expanding every directory renders the whole listing on open — the pane
// floods and scrolling it is useless. Collapsed-by-default keeps the initial
// view to top-level entries; the user expands the directories they care about.
export const TREE_INITIAL_EXPANSION: FileTreeInitialExpansion = "closed"

export const joinPath = (parent: string, name: string): string =>
  parent === "" ? name : `${parent}/${name}`

export const parentOf = (path: string): string => {
  const i = path.lastIndexOf("/")
  return i < 0 ? "" : path.slice(0, i)
}

// Row layout: beta.4 ships every row with a trailing decoration lane
// (`[data-item-section='decoration'] { flex: 1 1 0 }`) that grows to absorb the
// free row width, leaving the name section at its natural width on the left.
// We previously also forced `[data-item-section='content'] { flex-grow: 1 }` (a
// workaround from an older lib version whose name box collapsed and
// middle-truncated short names). On beta.4 that made content AND decoration both
// claim the free space, so short names (".pid", "doc") sat in an over-wide box
// and MiddleTruncate centered them. Dropped — the native decoration lane already
// fills the row, matching the trees.software demo (same beta.4, no such hack).
//
// Safari fix: the lib's MiddleTruncate detects overflow with a size-container
// query, `@container measure (height > 1lh)` (in @layer base), that drives both
// the "…" marker and the per-segment clipping. WebKit mis-resolves font-relative
// units (`lh`, `em`) to ~0 inside a `container-type: size` query condition (see
// the WebKit `lh` unit-resolution bugs, e.g. bugs.webkit.org id=252108), so the
// query is always true and EVERY label is clipped to almost nothing (".aud…",
// "hc…s"). Chrome resolves the unit correctly, hence Safari-only breakage.
//
// Swapping the threshold unit doesn't help — em is mis-resolved the same way —
// so Safari-only (`@supports (-webkit-hyphens: none)`, which only WebKit matches)
// we abandon the container-query machinery entirely and fall back to native
// `text-overflow: ellipsis`, which WebKit renders reliably. Each MiddleTruncate
// segment becomes a plain nowrap ellipsis box; the kept/dropped flex priorities
// still split the name, so Safari gets end-ellipsis per half instead of the
// fancy single marker. Non-WebKit engines skip the block and keep the lib's
// original behaviour. Lands in `@layer unsafe`, overriding the `base` rules.
export const TREE_UNSAFE_CSS = `
@supports (-webkit-hyphens: none) {
  [data-truncate-marker-cell],
  [data-truncate-content='overflow'] { display: none !important; }
  [data-truncate-container] { display: block; height: auto; min-width: 0; overflow: hidden; }
  [data-truncate-grid] { display: block; min-width: 0; }
  [data-truncate-grid] > * { min-width: 0; }
  [data-truncate-content='visible'] {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}
`

// Human-readable size; matches what a casual reader expects. Used only in the
// tree UI, so locale-naive units (1024 base) are fine.
export const formatSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}
