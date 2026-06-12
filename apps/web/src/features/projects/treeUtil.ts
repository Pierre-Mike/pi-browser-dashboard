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
export const TREE_UNSAFE_CSS = "[data-item-section='content'] { flex-grow: 1; }"

// Human-readable size; matches what a casual reader expects. Used only in the
// tree UI, so locale-naive units (1024 base) are fine.
export const formatSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}
