import { describe, expect, test } from "bun:test"
import {
  DEFAULT_THEME,
  describeMachineTheme,
  findFamily,
  machineMatchesChoice,
  nextThemeFamily,
  resolveTheme,
  resolveThemeChoice,
  schemeForThemeName,
  serializeTheme,
  THEME_FAMILIES,
  THEME_MODE_LABELS,
  THEME_MODES,
  THEME_PALETTE_ACTIONS,
  type ThemeMode,
  themeCommandFor,
  themeOfferFromSettings,
  themeOfferFromStored,
} from "./theme.core"

// The old `parseStoredTheme({ raw })` is exactly
// `resolveThemeChoice({ browser: themeOfferFromStored({ raw }), machine: {} })`,
// so its cases live on below with no machine default in play.
const fromStored = (raw: string | null) =>
  resolveThemeChoice({ browser: themeOfferFromStored({ raw }), machine: {} })

const ids = THEME_FAMILIES.map((f) => f.id)

describe("THEME_FAMILIES", () => {
  test("ships the eight sample families", () => {
    // The first four are the restrained set the design system started with; the
    // last four are deliberately saturated. Appending is the only safe edit —
    // `pid` must stay index 0 (daisyUI's `default`/`prefersdark` pair, and the
    // no-JS fallback), and `nextThemeFamily` cycles in this order.
    expect(ids).toEqual(["pid", "mono", "terminal", "sunset", "candy", "arcade", "citrus", "prism"])
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

describe("themeOfferFromStored", () => {
  test("round-trips every family × mode through serializeTheme", () => {
    for (const family of THEME_FAMILIES) {
      for (const mode of THEME_MODES) {
        const choice = { family: family.id, mode }
        expect(themeOfferFromStored({ raw: serializeTheme({ choice }) })).toEqual(choice)
        expect(fromStored(serializeTheme({ choice }))).toEqual(choice)
      }
    }
  })

  test("a missing key offers nothing, so the next source decides", () => {
    expect(themeOfferFromStored({ raw: null })).toEqual({ family: undefined, mode: undefined })
    expect(fromStored(null)).toEqual(DEFAULT_THEME)
    expect(fromStored("")).toEqual(DEFAULT_THEME)
  })

  test("garbage falls back instead of wedging the UI", () => {
    for (const raw of ["{}", '{"family":"mono"}', "::::", "mono", "  ", "pid:pid:pid"]) {
      const choice = fromStored(raw)
      expect(findFamily(choice.family)).toBeDefined()
      expect(THEME_MODES).toContain(choice.mode)
    }
  })

  test("an unknown family keeps a recognised mode", () => {
    expect(themeOfferFromStored({ raw: "vaporwave:dark" })).toEqual({
      family: undefined,
      mode: "dark",
    })
    expect(fromStored("vaporwave:dark")).toEqual({ family: "pid", mode: "dark" })
  })

  test("an unknown mode keeps a recognised family", () => {
    expect(fromStored("terminal:sepia")).toEqual({ family: "terminal", mode: "system" })
  })

  test("a legacy bare theme name degrades to the default choice", () => {
    // The key never held one, but a stale value must not paint a broken page.
    expect(fromStored("piddark")).toEqual(DEFAULT_THEME)
  })
})

describe("themeOfferFromSettings", () => {
  test("reads a stored machine-wide default", () => {
    expect(themeOfferFromSettings({ ui: { themeFamily: "sunset", themeMode: "light" } })).toEqual({
      family: "sunset",
      mode: "light",
    })
  })

  test("an absent section offers nothing", () => {
    expect(themeOfferFromSettings({ ui: undefined })).toEqual({
      family: undefined,
      mode: undefined,
    })
  })

  // Both halves are opaque strings on the wire (the daemon does not own the
  // catalog), so "unset" and "a family this build dropped" have to behave alike.
  test("empty and unrecognised halves both offer nothing", () => {
    expect(themeOfferFromSettings({ ui: { themeFamily: "", themeMode: "" } })).toEqual({
      family: undefined,
      mode: undefined,
    })
    expect(
      themeOfferFromSettings({ ui: { themeFamily: "vaporwave", themeMode: "sepia" } }),
    ).toEqual({ family: undefined, mode: undefined })
  })

  test("a half that is still recognised survives its broken partner", () => {
    expect(themeOfferFromSettings({ ui: { themeFamily: "vaporwave", themeMode: "dark" } })).toEqual(
      {
        family: undefined,
        mode: "dark",
      },
    )
  })
})

describe("resolveThemeChoice", () => {
  const machine = { family: "terminal", mode: "dark" } as const

  test("the browser's pick overrides the machine default", () => {
    expect(resolveThemeChoice({ browser: { family: "mono", mode: "light" }, machine })).toEqual({
      family: "mono",
      mode: "light",
    })
  })

  test("a browser with no pick of its own inherits the machine default", () => {
    expect(resolveThemeChoice({ browser: {}, machine })).toEqual(machine)
  })

  test("with neither source it is pid in system mode", () => {
    expect(resolveThemeChoice({ browser: {}, machine: {} })).toEqual(DEFAULT_THEME)
    expect(DEFAULT_THEME).toEqual({ family: "pid", mode: "system" })
  })

  // Per half, not per source: the whole reason the offer type has two optional
  // fields instead of being all-or-nothing.
  test("each half is decided independently", () => {
    expect(resolveThemeChoice({ browser: { mode: "light" }, machine })).toEqual({
      family: "terminal",
      mode: "light",
    })
    expect(resolveThemeChoice({ browser: { family: "sunset" }, machine })).toEqual({
      family: "sunset",
      mode: "dark",
    })
    expect(resolveThemeChoice({ browser: { family: "sunset" }, machine: {} })).toEqual({
      family: "sunset",
      mode: "system",
    })
  })

  test("resolves to a paintable theme for every combination of sources", () => {
    const offers = [{}, { family: "mono" }, { mode: "dark" as const }, machine]
    for (const browser of offers) {
      for (const other of offers) {
        const choice = resolveThemeChoice({ browser, machine: other })
        expect(findFamily(choice.family)).toBeDefined()
        expect(THEME_MODES).toContain(choice.mode)
      }
    }
  })
})

describe("describeMachineTheme", () => {
  test("names both halves of a fully-set default", () => {
    const described = describeMachineTheme({ machine: { family: "terminal", mode: "dark" } })
    expect(described).toContain("Terminal")
    expect(described).toContain(THEME_MODE_LABELS.dark)
  })

  test("says so when nothing is set", () => {
    expect(describeMachineTheme({ machine: {} })).toBe("not set")
  })

  test("a half that offers nothing reads as 'any', because the browser decides it", () => {
    expect(describeMachineTheme({ machine: { mode: "light" } })).toContain("any family")
    expect(describeMachineTheme({ machine: { family: "mono" } })).toContain("any mode")
  })
})

describe("machineMatchesChoice", () => {
  test("true only when both halves already agree", () => {
    const choice = { family: "mono", mode: "dark" } as const
    expect(machineMatchesChoice({ machine: { family: "mono", mode: "dark" }, choice })).toBe(true)
    expect(machineMatchesChoice({ machine: { family: "mono", mode: "light" }, choice })).toBe(false)
    expect(machineMatchesChoice({ machine: { family: "mono" }, choice })).toBe(false)
    expect(machineMatchesChoice({ machine: {}, choice })).toBe(false)
  })
})

describe("nextThemeFamily", () => {
  test("cycles through every family and wraps to the first", () => {
    const ordered = THEME_FAMILIES.map((family) => family.id)
    const walk = ordered.reduce<string[]>(
      (seen) => [...seen, nextThemeFamily({ family: seen[seen.length - 1] ?? "" })],
      [DEFAULT_THEME.family],
    )
    // Started on pid, so one step per family lands back on pid.
    expect(walk).toEqual([...ordered, DEFAULT_THEME.family])
  })

  test("an unrecognised family starts the cycle over rather than sticking", () => {
    expect(nextThemeFamily({ family: "vaporwave" })).toBe(DEFAULT_THEME.family)
    expect(nextThemeFamily({ family: "" })).toBe(DEFAULT_THEME.family)
  })
})

describe("THEME_PALETTE_ACTIONS", () => {
  test("registers one command per mode plus the family cycle", () => {
    expect(THEME_PALETTE_ACTIONS).toHaveLength(THEME_MODES.length + 1)
    expect(new Set(THEME_PALETTE_ACTIONS.map((a) => a.id)).size).toBe(THEME_PALETTE_ACTIONS.length)
  })

  test("every label is findable by typing 'theme'", () => {
    for (const action of THEME_PALETTE_ACTIONS) {
      expect(action.label.toLowerCase()).toContain("theme")
    }
  })

  test("every registered id resolves to a command", () => {
    for (const action of THEME_PALETTE_ACTIONS) {
      expect(themeCommandFor({ id: action.id, current: DEFAULT_THEME })).not.toBeNull()
    }
  })
})

describe("themeCommandFor", () => {
  test("the family command advances from whatever is current", () => {
    expect(
      themeCommandFor({ id: "theme:family:next", current: { family: "pid", mode: "system" } }),
    ).toEqual({ family: nextThemeFamily({ family: "pid" }) })
  })

  test("each mode command names its mode", () => {
    for (const mode of THEME_MODES) {
      expect(themeCommandFor({ id: `theme:mode:${mode}`, current: DEFAULT_THEME })).toEqual({
        mode,
      })
    }
  })

  test("an id from another build is a value, not an exception", () => {
    for (const id of ["", "theme:mode:sepia", "theme:mode:", "project:foo", "theme:family:prev"]) {
      expect(themeCommandFor({ id, current: DEFAULT_THEME })).toBeNull()
    }
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
