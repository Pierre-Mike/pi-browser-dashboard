export const joinPath = (parent: string, name: string): string =>
  parent === "" ? name : `${parent}/${name}`

export const parentOf = (path: string): string => {
  const i = path.lastIndexOf("/")
  return i < 0 ? "" : path.slice(0, i)
}

// @pierre/trees ships its row label section as `flex: 0 1 auto`, so the name
// box collapses to its truncated intrinsic width instead of filling the row —
// MiddleTruncate then middle-truncates even short names (e.g. ".github" →
// ".git…hub") with most of the row sitting empty. Letting the content section
// grow makes it claim the free row width, so names only truncate when they
// genuinely overflow. Injected via the lib's `unsafeCSS` escape hatch, which
// lands in `@layer unsafe` and wins over the core `@layer base` rule.
//
// Safari-only fix: the lib detects overflow with a size-container query,
// `@container measure (height > 1lh)`, that toggles the "…" marker. WebKit
// resolves the `lh` unit to ~0 inside a `container-type: size` query condition
// (see the WebKit `lh` unit-resolution bugs, e.g. bugs.webkit.org id=252108),
// so the condition is always true and EVERY label shows the marker and
// collapses to almost nothing (".aud…", "hc…s"). Chrome resolves 1lh correctly,
// hence Safari-only breakage. Container-query conditions can't read a custom
// property, so we re-run the detection (Safari-only via `-webkit-hyphens`) with
// `em`, which WebKit resolves correctly: one line is 1lh (~1.33em at the tree
// font), two lines 2lh (~2.67em), so a 2em threshold sits between them for any
// line-height ratio in (1, 2). This lands in `@layer unsafe` and overrides the
// base `1lh` rule; non-WebKit engines skip the block and keep the exact 1lh path.
export const TREE_UNSAFE_CSS = `
[data-item-section='content'] { flex-grow: 1; }

@supports (-webkit-hyphens: none) {
  [data-truncate-marker] { opacity: 0; }
  @container measure (height > 2em) {
    [data-truncate-marker] { opacity: 1; }
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
