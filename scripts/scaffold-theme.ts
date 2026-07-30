#!/usr/bin/env bun
/**
 * scaffold:theme — generate a daisyUI theme family in the canonical shape.
 *
 *   bun run scaffold:theme <family> \
 *     --label "Vapor — magenta / cyan" \
 *     --hues 320,190,100,205,140,40,5 \
 *     --shape 0.6875rem,0.1875rem,0.8125rem,5px,1 \
 *     [--dry-run] [--verbose]
 *
 * Why a generator rather than a written recipe — the same argument
 * `scaffold-slice.ts` makes, with receipts. The binary-search contrast solver
 * ("the value closest to maximum chroma that still clears 4.5:1 on this
 * variant's own base-100") has been written ad hoc and thrown away three times:
 * once for `candy`/`arcade`/`citrus`, once for `prism`, once for `neon`. Each
 * rewrite re-derived the same technique and left nothing behind but hexes.
 *
 * A family is also **six files**, not one, and they can disagree: the tokens in
 * `tailwind.config.js`, the catalog entry in `theme.core.ts`, the pinned id list
 * in `theme.core.test.ts`, the shape row in `themeCatalog.test.ts`, and the two
 * xterm palettes plus their lookup in `terminalTheme.ts`. Forget the shape row
 * and the failure is an `undefined` in an unrelated test; forget the palette and
 * the family silently inherits `pid`'s slate/sky pane, which is the exact defect
 * per-theme palettes were introduced to fix.
 *
 * So: solve, measure, refuse if anything misses, then write all six. `bun run
 * theme:check` passes immediately afterwards, which means any failure you then
 * see is yours.
 *
 * What this does NOT do, on purpose: write the design story. The generated family
 * is a *correct* starting point — every floor cleared, every slot declared — not
 * a designed one. `apps/web/CLAUDE.md` is where a family earns its paragraph, and
 * the generated character rule in `terminalTheme.test.ts` is a description of the
 * pane until someone replaces it with the claim the family is actually for.
 *
 * The maths lives in `theme-solve.core.ts`, the templates and anchors in
 * `theme-emit.core.ts`; both are pure and both have co-located tests that assert
 * a generated family clears every floor the four theme gates enforce.
 */
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
  renderThemesBlock,
  retitleFamilyCount,
} from "./theme-emit.core"
import {
  type FamilySpec,
  hueWarnings,
  type Parsed,
  parseHues,
  parseShape,
  SHAPE_KEYS,
  type ShapeTuple,
  shapeCollision,
  solveFamily,
} from "./theme-solve.core"

const root = join(import.meta.dir, "..")
const web = join(root, "apps/web")

const FILES = {
  config: join(web, "tailwind.config.js"),
  catalog: join(web, "src/lib/ui/theme.core.ts"),
  catalogTest: join(web, "src/lib/ui/theme.core.test.ts"),
  shapeTest: join(web, "src/lib/ui/themeCatalog.test.ts"),
  palettes: join(web, "src/features/terminal/terminalTheme.ts"),
  palettesTest: join(web, "src/features/terminal/terminalTheme.test.ts"),
} as const

const USAGE = `usage: bun run scaffold:theme <family> --label "<label>" --hues <6-7 angles> --shape <${SHAPE_KEYS.join(",")}> [--dry-run] [--verbose]

  <family>   lowercase, no dashes — the daisyUI themes become <family>light / <family>dark
  --hues     6 or 7 hue angles in [0,360), mapped in order onto
             primary,secondary,accent,info,success,warning,error
             (6 hues: success borrows accent's, as prismlight does)
  --shape    --radius-box,--radius-field,--radius-selector,--border,--depth
             must be unique across families; the gate rejects two shaped alike
  --dry-run  solve and print, write nothing — use this to hunt hues

example:
  bun run scaffold:theme vapor --label "Vapor — magenta / cyan" \\
    --hues 320,190,100,205,140,40,5 --shape 1.25rem,0.375rem,1rem,3px,1`

const fail = (message: string): never => {
  console.error(`✖ ${message}`)
  process.exit(1)
}

const after = (input: { readonly args: readonly string[]; readonly flag: string }): string => {
  const at = input.args.indexOf(input.flag)
  return at < 0 ? "" : (input.args[at + 1] ?? "")
}

const flagValue = (input: { readonly args: readonly string[]; readonly name: string }): string => {
  const value = after({ args: input.args, flag: `--${input.name}` })
  if (value === "" || value.startsWith("--")) fail(`missing --${input.name}\n\n${USAGE}`)
  return value
}

const taken = <T>(parsed: Parsed<T>): T => {
  if ("error" in parsed) fail(parsed.error)
  return "value" in parsed ? parsed.value : (undefined as T)
}

// ── arguments ───────────────────────────────────────────────────────────────

const args = process.argv.slice(2)
const VALUE_FLAGS = ["--label", "--hues", "--shape"]
const KNOWN = [...VALUE_FLAGS, "--dry-run", "--verbose"]
const unknown = args.find((arg) => arg.startsWith("--") && !KNOWN.includes(arg))
if (unknown !== undefined) fail(`unknown flag ${unknown}\n\n${USAGE}`)

const dryRun = args.includes("--dry-run")
const verbose = args.includes("--verbose")
// A flag's value is a positional-looking token, so the family id is the one
// positional that is not consumed by a `--flag` before it.
const consumed = new Set(VALUE_FLAGS.map((flag) => after({ args, flag })))
const id = args.find((arg) => !arg.startsWith("--") && !consumed.has(arg)) ?? ""
// No dashes: the daisyUI theme name is `<id>light`, the CSS selector is
// `[data-theme=<id>light]`, and the `dark` suffix is load-bearing for
// tailwind's darkMode selector. A single lowercase word keeps all three legible.
if (!/^[a-z][a-z0-9]*$/.test(id)) fail(`family id must be a single lowercase word\n\n${USAGE}`)

const spec: FamilySpec = {
  id,
  label: flagValue({ args, name: "label" }),
  hues: taken(parseHues({ raw: flagValue({ args, name: "hues" }) })),
  shape: taken(parseShape({ raw: flagValue({ args, name: "shape" }) })),
}

// ── what already exists ─────────────────────────────────────────────────────
//
// Read from `tailwind.config.js` at runtime, the same trick the four theme gates
// use: the config is the single declaration, so a collision check that read a
// list kept here instead would be the mirror this repo keeps deleting.

const config = await import(FILES.config)
const themes = config.THEMES as ReadonlyArray<Record<string, string>>
const existing = themes.map((theme) => ({
  name: theme.name ?? "",
  shape: Object.fromEntries(SHAPE_KEYS.map((token) => [token, theme[token] ?? ""])) as ShapeTuple,
}))

if (existing.some((theme) => theme.name.startsWith(id))) {
  fail(`tailwind.config.js already declares a theme starting "${id}"`)
}

const collision = shapeCollision({ existing, shape: spec.shape })
if (collision !== null) {
  fail(
    `--shape is identical to ${collision}'s.\n` +
      "  themeCatalog.test.ts requires the shape rows to be distinct as whole tuples:\n" +
      "  a family shaped like an existing one is a colour-only family, which is the\n" +
      "  state tokenised shape replaced. Move a radius, the border width or the depth.",
  )
}

// ── solve ───────────────────────────────────────────────────────────────────

const family = solveFamily({ spec })
console.error(renderReport({ family, verbose }))

for (const warning of hueWarnings({ hues: spec.hues })) console.warn(`⚠ ${warning}`)

if (family.failures.length > 0) {
  fail(
    `${family.failures.length} measurement(s) miss their floor — see MISS above.\n` +
      "  A floor unreachable at a hue means that hue cannot carry that role; move the\n" +
      "  hue rather than lowering the floor. Saturation is what reads as pop, and\n" +
      "  lightness is what the gate measures — the solver has already spent all of\n" +
      "  the lightness there was.",
  )
}

// The pane colours have to be unique across every theme: `terminalTheme.test.ts`
// asserts it, because a duplicate is how a family silently keeps `pid`'s pane.
// Imported rather than re-derived, for the same reason the shapes are read from
// the config.
const { terminalTheme } = await import(FILES.palettes)
const panes = new Set(
  existing.map(
    (theme) => (terminalTheme({ theme: theme.name }) as { background: string }).background,
  ),
)
for (const variant of [family.light, family.dark]) {
  const pane = variant.palette.background ?? ""
  if (panes.has(pane)) fail(`${variant.name}'s pane ${pane} is already some other theme's`)
}

// ── write ───────────────────────────────────────────────────────────────────

const rewrite = async (input: {
  readonly path: string
  readonly edit: (source: string) => Parsed<string>
}): Promise<void> => {
  const source = await Bun.file(input.path).text()
  const next = taken(input.edit(source))
  if (!dryRun) await Bun.write(input.path, next)
  console.error(`${dryRun ? "would edit" : "edited"} ${input.path.slice(root.length + 1)}`)
}

if (dryRun) {
  console.error("\n── tailwind.config.js ──")
  console.error(renderThemesBlock({ family }))
  console.error("── terminalTheme.ts ──")
  console.error(renderPalettesBlock({ family }))
}

await rewrite({
  path: FILES.config,
  edit: (source) => insertThemes({ source, block: renderThemesBlock({ family }) }),
})
await rewrite({
  path: FILES.catalog,
  edit: (source) => insertCatalogEntry({ source, entry: renderCatalogEntry({ spec }) }),
})
await rewrite({
  path: FILES.shapeTest,
  edit: (source) => insertShapeRow({ source, row: renderShapeRow({ spec }) }),
})
await rewrite({
  path: FILES.palettes,
  edit: (source) =>
    insertPalettes({
      source,
      block: renderPalettesBlock({ family }),
      entries: renderPaletteMapEntries({ id }),
    }),
})
await rewrite({
  path: FILES.palettesTest,
  edit: (source) => insertCharacterTest({ source, block: renderCharacterTest({ family }) }),
})
await rewrite({
  path: FILES.catalogTest,
  edit: (source) => {
    const withId = insertFamilyId({ source, id })
    if ("error" in withId) return withId
    const retitled = retitleFamilyCount({ source: withId.value, themesBefore: existing.length })
    if (retitled.note !== null) console.warn(`⚠ ${retitled.note}`)
    return { value: retitled.text }
  },
})

if (dryRun) {
  console.error("\n--dry-run: nothing written.")
  process.exit(0)
}

// Formatting last, so the generated blocks are lint:ci-clean out of the box —
// same final step as scaffold-slice.ts.
Bun.spawnSync(
  ["bunx", "biome", "check", "--write", "--no-errors-on-unmatched", ...Object.values(FILES)],
  { cwd: root, stdout: "inherit", stderr: "inherit" },
)

console.error(`
next steps:
  1. bun run theme:check          — the four gates, ~0.1s. Green already.
  2. open /theme-lab in the app    — every token, every component the app uses,
     and the state chips in BOTH their idle and their reporting columns. That
     last pair is the review that rejected prism's first version: five of seven
     ink tokens only paint when a session has something to report, so an idle
     page can show one hue and still pass every gate.
  3. retune by taste. The solver spends all of the lightness there is, so a hue
     that came back bronze or olive had nowhere else to go — move the hue, not
     the floor. Re-run with --dry-run to see the numbers before you commit.
  4. replace the GENERATED character rule in terminalTheme.test.ts with the
     sentence this family is actually for. A channel ordering ("magenta-leaning:
     red AND blue over green") is what stops it drifting into a copy of another
     family.
  5. give ${id} its paragraph in apps/web/CLAUDE.md — the table of shape rows and
     what the family is for. The generator writes correct; you write why.
  6. bun run verify
`)
