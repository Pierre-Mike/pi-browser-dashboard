// Shared @pierre/diffs render options. Centralised so every File / PatchDiff
// across the app highlights with the same Shiki themes and follows the OS
// colour-scheme — matching Tailwind's `darkMode: "media"` strategy via
// `themeType: "system"` (the lib swaps github-light ↔ github-dark itself).

export const DIFF_THEME = { light: "github-light", dark: "github-dark" } as const

// Options for a single read-only File preview (FileTree code/text bodies).
// The surrounding FilePreview renders its own toolbar/header, so we suppress
// the library's file header to avoid a duplicate.
export const CODE_FILE_OPTIONS = {
  theme: DIFF_THEME,
  themeType: "system",
  disableFileHeader: true,
  overflow: "scroll",
} as const

// Options for a multi-file unified diff (FilesTab). Keep the per-file headers —
// they replace the bespoke left-hand file list we used to hand-roll.
export const PATCH_DIFF_OPTIONS = {
  theme: DIFF_THEME,
  themeType: "system",
  diffStyle: "unified",
} as const
