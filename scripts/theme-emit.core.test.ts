import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  insertCatalogEntry,
  insertCharacterTest,
  insertFamilyId,
  insertPalettes,
  insertShapeRow,
  insertThemes,
  renderCatalogEntry,
  renderCharacterTest,
  renderPaletteMapEntries,
  renderPalettesBlock,
  renderReport,
  renderShapeRow,
  renderThemeObject,
  renderThemesBlock,
  retitleFamilyCount,
} from "./theme-emit.core"
import { type FamilySpec, type ShapeTuple, solveFamily } from "./theme-solve.core"

const WEB = join(import.meta.dir, "..", "apps", "web")

const read = (path: string): string => readFileSync(join(WEB, path), "utf8")

const SHAPE: ShapeTuple = {
  "--radius-box": "0.6875rem",
  "--radius-field": "0.1875rem",
  "--radius-selector": "0.8125rem",
  "--border": "5px",
  "--depth": "1",
}

const SPEC: FamilySpec = {
  id: "testfam",
  label: "Testfam — generated",
  hues: [330, 190, 100, 205, 140, 40, 5],
  shape: SHAPE,
}

const family = solveFamily({ spec: SPEC })

const unwrap = (parsed: { readonly value: string } | { readonly error: string }): string => {
  if ("error" in parsed) throw new Error(parsed.error)
  return parsed.value
}

// The point of reading the real files here rather than fixtures: the anchors are
// the generator's coupling to six files it does not own, and this is what turns a
// refactor that moves one into a red `bun run test` instead of a scaffold that
// writes a broken family six months later.
describe("every anchor still exists in the file it points at", () => {
  it("tailwind.config.js — the THEMES array", () => {
    const out = unwrap(
      insertThemes({ source: read("tailwind.config.js"), block: "  { name: 'x' },\n" }),
    )
    expect(out).toContain("{ name: 'x' },")
    // Inserted inside the array, before the export that follows it.
    expect(out.indexOf("{ name: 'x' },")).toBeLessThan(out.indexOf("export const DAISYUI_OPTIONS"))
  })

  it("theme.core.ts — the THEME_FAMILIES array", () => {
    const source = read("src/lib/ui/theme.core.ts")
    const out = unwrap(insertCatalogEntry({ source, entry: renderCatalogEntry({ spec: SPEC }) }))
    expect(out).toContain('id: "testfam"')
    // After the last existing family, and still inside the array.
    expect(out.indexOf('id: "testfam"')).toBeGreaterThan(out.indexOf('id: "prism"'))
    expect(out.indexOf('id: "testfam"')).toBeLessThan(out.indexOf("export type ThemeChoice"))
  })

  it("theme.core.test.ts — the pinned id list", () => {
    const source = read("src/lib/ui/theme.core.test.ts")
    const out = unwrap(insertFamilyId({ source, id: "testfam" }))
    expect(out).toContain('"testfam",')
    // Every id that was there is still there, and pid is still first.
    for (const id of ["pid", "mono", "terminal", "sunset"]) expect(out).toContain(`"${id}",`)
    expect(out.indexOf('"pid",')).toBeLessThan(out.indexOf('"testfam",'))
  })

  it("themeCatalog.test.ts — the SHAPE_BY_FAMILY table", () => {
    const source = read("src/lib/ui/themeCatalog.test.ts")
    const out = unwrap(insertShapeRow({ source, row: renderShapeRow({ spec: SPEC }) }))
    expect(out).toContain("testfam: {")
    expect(out.indexOf("testfam: {")).toBeLessThan(out.indexOf("} as const"))
  })

  it("terminalTheme.ts — the palette consts and the PALETTES lookup", () => {
    const source = read("src/features/terminal/terminalTheme.ts")
    const out = unwrap(
      insertPalettes({
        source,
        block: renderPalettesBlock({ family }),
        entries: renderPaletteMapEntries({ id: "testfam" }),
      }),
    )
    expect(out).toContain("const testfamLight: TerminalTheme = {")
    expect(out).toContain("const testfamDark: TerminalTheme = {")
    expect(out).toContain("testfamlight: testfamLight,")
    // A palette declared after the lookup that reads it would not compile.
    expect(out.indexOf("const testfamLight")).toBeLessThan(
      out.indexOf("testfamlight: testfamLight"),
    )
  })

  it("terminalTheme.test.ts — the last describe, where character rules live", () => {
    const source = read("src/features/terminal/terminalTheme.test.ts")
    const out = unwrap(insertCharacterTest({ source, block: renderCharacterTest({ family }) }))
    expect(out).toContain("keeps the testfam family's own pane")
    // Inside the describe that owns the other families' character rules, which is
    // where `at()` and `terminalTheme()` are in scope.
    expect(out.indexOf("keeps the testfam family")).toBeGreaterThan(
      out.indexOf("each pane sits inside its family's chrome"),
    )
    expect(out.trimEnd().endsWith("})")).toBe(true)
  })
})

describe("a moved anchor fails as a value, not as a throw", () => {
  it("reports the file and the shape it wanted", () => {
    const out = insertThemes({ source: "const nothing = 1\n", block: "x" })
    expect(out).toHaveProperty("error")
    expect("error" in out ? out.error : "").toContain("tailwind.config.js")
  })

  it("refuses to list a family id twice", () => {
    const source = read("src/lib/ui/theme.core.test.ts")
    expect(insertFamilyId({ source, id: "prism" })).toHaveProperty("error")
  })

  it("reports each of the other five anchors on an empty file", () => {
    for (const parsed of [
      insertCatalogEntry({ source: "", entry: "x" }),
      insertShapeRow({ source: "", row: "x" }),
      insertPalettes({ source: "", block: "x", entries: "y" }),
      insertCharacterTest({ source: "", block: "x" }),
      insertFamilyId({ source: "", id: "x" }),
    ]) {
      expect(parsed).toHaveProperty("error")
    }
  })
})

describe("rendering", () => {
  it("quotes the keys that need quoting and leaves `name` bare", () => {
    const out = renderThemeObject({ tokens: family.light.tokens })
    expect(out).toContain(`name: "testfamlight",`)
    expect(out).toContain(`"color-scheme": "light",`)
    expect(out).toContain(`"--color-base-100": "`)
  })

  it("emits both variants, light first, so pid keeps index 0 and the pairs stay adjacent", () => {
    const out = renderThemesBlock({ family })
    expect(out.indexOf("testfamlight")).toBeLessThan(out.indexOf("testfamdark"))
  })

  it("emits all sixteen ANSI slots per palette", () => {
    const out = renderPalettesBlock({ family })
    for (const slot of ["black", "brightWhite", "brightMagenta", "cursor", "background"]) {
      expect(out).toContain(`  ${slot}: "#`)
    }
  })

  it("asserts only strict channel orderings in the character test", () => {
    // A tie carries no ordering, and asserting one would be false the moment a
    // channel rounds the other way.
    const out = renderCharacterTest({ family })
    expect(out).toContain("toBeGreaterThan")
    expect(out).not.toContain("toBeGreaterThanOrEqual")
    expect(out).toContain("testfamlight")
    expect(out).toContain("testfamdark")
  })

  it("renders the measured table, with every miss visible even when terse", () => {
    const terse = renderReport({ family, verbose: false })
    expect(terse).toContain("testfam:")
    expect(terse).toContain("text-primary")
    // A solved family has no misses, so the terse view hides the ANSI bulk.
    expect(terse).not.toContain("ansi.brightMagenta")
    expect(renderReport({ family, verbose: true })).toContain("ansi.brightMagenta")
  })
})

describe("the family count in the pinned test's title", () => {
  // The whole reason `themesBefore` is the parameter and the arithmetic is inside
  // the function: the first version took a family count, the call site passed the
  // count *before* the new family, and the word silently stayed one behind while
  // the generator printed "could not update". Feeding it the same input the
  // generator has — every theme in tailwind.config.js — is what makes that
  // testable at all.
  const themes = async (): Promise<number> => {
    const mod = await import(join(WEB, "tailwind.config.js"))
    return (mod.THEMES as readonly unknown[]).length
  }

  it("advances the number word in the real file, from the same input the generator has", async () => {
    const source = read("src/lib/ui/theme.core.test.ts")
    // Read the current word from the file rather than hardcoding it: this test has
    // to keep working as families are added.
    const words = ["nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen"]
    const current = [...source.matchAll(/the (\w+) sample families/g)].map((m) => m[1])
    expect(current.length, "theme.core.test.ts no longer states a family count").toBeGreaterThan(0)
    const at = words.indexOf(current[0] ?? "")
    expect(at, `unexpected count word "${current[0]}" — extend this test's list`).toBeGreaterThan(
      -1,
    )
    const out = retitleFamilyCount({ source, themesBefore: await themes() })
    expect(out.note).toBe(null)
    expect(out.text).toContain(`the ${words[at + 1]} sample families`)
    expect(out.text).not.toContain(`the ${current[0]} sample families`)
  })

  it("returns a note rather than an error when the phrase is gone", () => {
    const out = retitleFamilyCount({ source: "no count here", themesBefore: 18 })
    expect(out.text).toBe("no count here")
    expect(out.note).toContain("by hand")
  })
})
