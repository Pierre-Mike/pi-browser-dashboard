import { describe, expect, it } from "bun:test"
import { CODE_FILE_OPTIONS, DIFF_THEME, PATCH_DIFF_OPTIONS } from "./diffsOptions"

describe("diffsOptions", () => {
  it("pairs github light/dark Shiki themes", () => {
    expect(DIFF_THEME).toEqual({ light: "github-light", dark: "github-dark" })
  })

  it("follows the OS colour scheme so it tracks Tailwind darkMode:media", () => {
    expect(CODE_FILE_OPTIONS.themeType).toBe("system")
    expect(PATCH_DIFF_OPTIONS.themeType).toBe("system")
  })

  it("suppresses the library file header for single-file previews (FilePreview owns the toolbar)", () => {
    expect(CODE_FILE_OPTIONS.disableFileHeader).toBe(true)
  })

  it("renders multi-file diffs unified, not split", () => {
    expect(PATCH_DIFF_OPTIONS.diffStyle).toBe("unified")
  })
})
