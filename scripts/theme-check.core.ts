/**
 * Which test files a theme change has to satisfy — the inner-loop subset of
 * `bun run verify`.
 *
 * Hunting a hex for a new family means running the same four files over and over.
 * `bun run verify` runs six typecheck projects, ~3,500 tests, the audit and the
 * ratchet to answer a question those four files answer on their own, so the loop
 * was paying full price for a fraction of the signal.
 *
 * The list lives in a module rather than inline in `package.json` for one
 * reason: `bun test <path>` treats its arguments as *filters*, so a path that no
 * longer exists silently narrows the run instead of failing it. Renaming
 * `semanticPalette.test.ts` would leave `theme:check` green over three files
 * forever. `theme-check.core.test.ts` asserts every path here is on disk, which
 * turns that fail-open into a red `bun run test`.
 *
 * Pure by shape (`*.core.ts`): data in, argv out. `scripts/theme-check.ts` spawns
 * it.
 */

/**
 * The four files, relative to `apps/web`, with why each one is in the loop:
 *
 *   themeCatalog.test.ts   — the config half. Loads `tailwind.config.js` at
 *                            runtime and asserts the token set, the shape row,
 *                            shape uniqueness across families, `base-content` at
 *                            7:1 on all three base surfaces, `primary-content`
 *                            at 4.5:1 on `primary`, and every ink token at 4.5:1
 *                            on `base-100`. This is the file a new hex fails.
 *   theme.core.test.ts     — the catalog half: family ids, order, `pid` at index
 *                            0, the light/dark suffix rule, palette commands.
 *   semanticPalette.test.ts— the raw-colour ratchet. A family is added by
 *                            editing config *data*, but the same change often
 *                            touches a component, and this is the gate that
 *                            catches a literal sneaking in.
 *   terminalTheme.test.ts  — the xterm pane: 32 ANSI slots, the 3:1 ink floor,
 *                            cursor == primary, pane between `base-100` and
 *                            `base-200` per channel, and each family's character
 *                            assertion.
 *
 * `semanticRadius.test.ts` is deliberately absent. It ratchets *component* class
 * names, not theme data — a family's shape lands in `tailwind.config.js` and is
 * checked by `themeCatalog.test.ts`. It runs in `bun run test:web` like the rest.
 */
export const THEME_GATE_FILES: readonly string[] = [
  "src/lib/ui/themeCatalog.test.ts",
  "src/lib/ui/theme.core.test.ts",
  "src/lib/ui/semanticPalette.test.ts",
  "src/features/terminal/terminalTheme.test.ts",
]

/**
 * The command to run them, as argv.
 *
 * No `-t` name filter, and that is a decision rather than an omission. Narrowing
 * to one family drops the shared floors — the contrast loops iterate every theme
 * inside one test each, so `-t candy` would skip the very assertions a new candy
 * hex is most likely to break. The failure messages already name the theme
 * (`candylight: text-primary on base-100 is 3.19:1`), so there is nothing left
 * for a filter to narrow except the gate itself.
 */
export const themeCheckArgv = (input: { readonly files: readonly string[] }): readonly string[] => [
  "bun",
  "test",
  ...input.files,
]
