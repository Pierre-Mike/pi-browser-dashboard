import { describe, expect, test } from "bun:test"
import {
  DEFAULT_THEME,
  findFamily,
  parseStoredTheme,
  resolveTheme,
  schemeForThemeName,
  serializeTheme,
  THEME_FAMILIES,
  THEME_MODE_LABELS,
  THEME_MODES,
  type ThemeMode,
} from "./theme.core"

const ids = THEME_FAMILIES.map((f) => f.id)

describe("THEME_FAMILIES", () => {
  test("ships the four sample families", () => {
    expect(ids).toEqual(["pid", "mono", "terminal", "sunset"])
  })

  test("pid is first, so it stays daisyUI's :root theme and the default", () => {
    expect(ids[0]).toBe("pid")
    expect(DEFAULT_THEME).toEqual({ family: "pid", mode: "system" })
  })

  test("every family carries both a light and a dark variant", () => {
    for (const family of THEME_FAMILIES) {
      expect(family.light).not.toBe(family.dark)
      expect(family.light.length).toBeGreaterThan(0)
      expect(family.dark.length).toBeGreaterThan(0)
      expect(family.label.length).toBeGreaterThan(0)
    }
  })

  test("dark variants end in 'dark' and light ones do not — the darkMode selector keys on it", () => {
    for (const family of THEME_FAMILIES) {
      expect(family.dark.endsWith("dark")).toBe(true)
      expect(family.light.endsWith("dark")).toBe(false)
    }
  })

  test("theme names are unique across families", () => {
    const names = THEME_FAMILIES.flatMap((f) => [f.light, f.dark])
    expect(new Set(names).size).toBe(names.length)
  })

  test("the existing pid theme names are unchanged", () => {
    expect(findFamily("pid")).toMatchObject({ light: "pidlight", dark: "piddark" })
  })
})

describe("THEME_MODES", () => {
  test("is system / light / dark and every mode has a label", () => {
    expect(THEME_MODES).toEqual(["system", "light", "dark"])
    for (const mode of THEME_MODES) expect(THEME_MODE_LABELS[mode].length).toBeGreaterThan(0)
  })
})

describe("findFamily", () => {
  test("returns the family for a known id", () => {
    expect(findFamily("terminal")?.dark).toBe("terminaldark")
  })

  test("returns undefined rather than throwing for an unknown id", () => {
    expect(findFamily("nope")).toBeUndefined()
    expect(findFamily("")).toBeUndefined()
  })
})

describe("resolveTheme", () => {
  test("light mode picks the light variant regardless of the OS", () => {
    for (const prefersDark of [true, false]) {
      expect(resolveTheme({ family: "sunset", mode: "light", prefersDark })).toBe("sunsetlight")
    }
  })

  test("dark mode picks the dark variant regardless of the OS", () => {
    for (const prefersDark of [true, false]) {
      expect(resolveTheme({ family: "mono", mode: "dark", prefersDark })).toBe("monodark")
    }
  })

  test("system mode follows the OS preference", () => {
    expect(resolveTheme({ family: "pid", mode: "system", prefersDark: true })).toBe("piddark")
    expect(resolveTheme({ family: "pid", mode: "system", prefersDark: false })).toBe("pidlight")
  })

  test("resolves both variants of every family", () => {
    for (const family of THEME_FAMILIES) {
      expect(resolveTheme({ family: family.id, mode: "light", prefersDark: false })).toBe(
        family.light,
      )
      expect(resolveTheme({ family: family.id, mode: "dark", prefersDark: false })).toBe(
        family.dark,
      )
    }
  })

  test("an unknown family falls back to the default family, never to nothing", () => {
    expect(resolveTheme({ family: "wat", mode: "light", prefersDark: false })).toBe("pidlight")
    expect(resolveTheme({ family: "", mode: "system", prefersDark: true })).toBe("piddark")
  })
})

describe("parseStoredTheme", () => {
  test("round-trips every family × mode through serializeTheme", () => {
    for (const family of THEME_FAMILIES) {
      for (const mode of THEME_MODES) {
        const choice = { family: family.id, mode }
        expect(parseStoredTheme({ raw: serializeTheme({ choice }) })).toEqual(choice)
      }
    }
  })

  test("a missing key falls back to the default family in system mode", () => {
    expect(parseStoredTheme({ raw: null })).toEqual(DEFAULT_THEME)
    expect(parseStoredTheme({ raw: "" })).toEqual(DEFAULT_THEME)
  })

  test("garbage falls back instead of wedging the UI", () => {
    for (const raw of ["{}", '{"family":"mono"}', "::::", "mono", "  ", "pid:pid:pid"]) {
      const parsed = parseStoredTheme({ raw })
      expect(findFamily(parsed.family)).toBeDefined()
      expect(THEME_MODES).toContain(parsed.mode)
    }
  })

  test("an unknown family keeps a recognised mode", () => {
    expect(parseStoredTheme({ raw: "vaporwave:dark" })).toEqual({ family: "pid", mode: "dark" })
  })

  test("an unknown mode keeps a recognised family", () => {
    expect(parseStoredTheme({ raw: "terminal:sepia" })).toEqual({
      family: "terminal",
      mode: "system",
    })
  })

  test("a legacy bare theme name degrades to the default choice", () => {
    // The key never held one, but a stale value must not paint a broken page.
    expect(parseStoredTheme({ raw: "piddark" })).toEqual(DEFAULT_THEME)
  })
})

describe("schemeForThemeName", () => {
  test("the dark variant of every family gives the dark xterm scheme", () => {
    for (const family of THEME_FAMILIES) {
      expect(schemeForThemeName({ theme: family.dark })).toBe("dark")
      expect(schemeForThemeName({ theme: family.light })).toBe("light")
    }
  })

  test("an unrecognised name reads as light", () => {
    expect(schemeForThemeName({ theme: "cupcake" })).toBe("light")
  })

  test("matches resolveTheme for every family × mode × OS preference", () => {
    for (const family of THEME_FAMILIES) {
      for (const mode of THEME_MODES as readonly ThemeMode[]) {
        for (const prefersDark of [true, false]) {
          const resolved = resolveTheme({ family: family.id, mode, prefersDark })
          const expected = mode === "dark" || (mode === "system" && prefersDark) ? "dark" : "light"
          expect(schemeForThemeName({ theme: resolved })).toBe(expected)
        }
      }
    }
  })
})
