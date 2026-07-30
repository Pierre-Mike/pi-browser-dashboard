# daisyUI 5 / Tailwind 4 — spike report

Branch: `spike/daisyui-5` (branched from `main` @ `daded99`). No PR against `main`.
Packages actually installed and exercised: `tailwindcss@4.3.3`, `@tailwindcss/vite@4.3.3`,
`daisyui@5.7.8`.

## Recommendation: go — but not for the reason it was queued

The migration is cheap, and every gate in the repo is green on the spike branch. That part
is settled by measurement, not argument: 9 files changed, `bun run verify` exits 0, and the
full 102-test Playwright suite passes.

The reason it went on the list does **not** hold up. daisyUI 5's `--border` and `--depth` are
read only by daisyUI's own component CSS. This app paints its panel chrome with hand-written
Tailwind (`border border-base-300`, 112 sites), so a `terminal` family asking for a 2px border
would thicken buttons, inputs, tabs and badges while every panel outline beside them stayed at
1px. That reads as an inconsistency, not as a decision. And daisyUI 5 **deletes**
`--animation-btn`, so `terminal`'s deliberate `0s` button transition ("a CRT does not ease")
stops being expressible at all.

So: take the upgrade as a **platform** move — it makes the theme system's strongest gate
stronger and lets the repo delete code it currently hand-rolls. Do not take it as the shape
upgrade. Getting `--border` to read as deliberate needs the 112 hand-written panel borders
converted first, and that is a bigger and riskier change than this one.

Two preconditions before merging:

1. Decide what happens to `--animation-btn`. It is one of the four shape tokens
   `themeCatalog.test.ts` uses to prove no two families are shaped alike. Either accept a
   uniform 0.2s button transition across all four families, or re-introduce the per-family
   duration as a plain CSS custom property the app applies itself.
2. Land it as a platform PR with no visual-design claims attached, so the before/after is
   "nothing moved" and any pixel that *does* move is a bug rather than a feature.

## What survives, what does not

| Thing | Fate |
|---|---|
| `tailwind.config.js` as the runtime-readable source of truth | **survives** — `@config` still loads it |
| `themeCatalog.test.ts` (all assertions) | **survives, and gains two** |
| `terminalTheme.test.ts` config reads | survives; loader needs the `--color-` prefix stripped |
| no-JS `prefers-color-scheme` fallback | **survives, with a better selector** |
| `semanticPalette.test.ts` / `semanticRadius.test.ts` | untouched, still green |
| corner-specific radius utilities | survive; daisyUI 5 now ships all 24 itself |
| `--rounded-box` → `--radius-box` | rename |
| `--rounded-btn` → `--radius-field` | rename |
| `--rounded-badge` → `--radius-selector` | rename |
| `--animation-btn` | **deleted by daisyUI 5, no replacement** |
| `base: false` | becomes `exclude: ["rootcolor"]` |
| `darkTheme: "piddark"` + array order | becomes per-theme `default:` / `prefersdark:` flags |
| `postcss.config.js`, `autoprefixer`, `postcss` | all deleted; Tailwind 4 prefixes via lightningcss |

## 1. The real cost

**Nine files.** Roughly a day, not a fortnight.

```
apps/web/package.json                              deps
apps/web/postcss.config.js                         deleted
apps/web/src/styles.css                            3 lines -> 2
apps/web/src/features/terminal/terminalTheme.test.ts  loader only
apps/web/src/lib/ui/themeCatalog.test.ts           loader + token names
apps/web/tailwind.config.js                        token renames, themes as plugins
apps/web/vite.config.ts                            + tailwindcss() plugin
biome.json                                         + css.parser.tailwindDirectives
bun.lock
```

The estimate came in low for one reason worth stating plainly: **Tailwind 4 still honours a
legacy JS config through `@config`**, including `theme.extend` and `plugins`. The CSS-first
rewrite that makes this migration sound large is *optional*. `styles.css` is two lines:

```css
@import "tailwindcss";
@config "../tailwind.config.js";
```

and the config keeps the eight themes as exported plain data, registered through daisyUI 5's
`daisyui/theme` JS plugin:

```js
import daisyui from "daisyui"
import daisyuiTheme from "daisyui/theme"

export const THEMES = [
  { name: "pidlight", default: true, "color-scheme": "light",
    "--color-primary": "#0369a1", /* … */ "--radius-box": "0.75rem" },
  { name: "piddark", prefersdark: true, "color-scheme": "dark", /* … */ },
  /* … */
]

export default {
  darkMode: ["selector", '[data-theme$="dark"]'],
  plugins: [
    daisyui({ themes: false, logs: false, exclude: ["rootcolor"] }),
    ...THEMES.map((t) => daisyuiTheme(t)),
  ],
}
```

That is the whole trick, and it is what keeps question 2 from being a problem at all.

### Utility churn

The v3→v4 renames touch fewer sites than expected, because the repo already bans raw palette
colours and raw radii:

| utility | sites | v4 meaning |
|---|---|---|
| `shadow-sm` | 35 | now means what `shadow-xs` used to; renders smaller if left alone |
| `outline-none` | 6 | → `outline-hidden` |
| `shadow-lg` / `shadow-xl` / `shadow-2xl` | 9 | scale shifted one step |
| `ring-1` | 4 | fine |
| `ring` | 1 | 3px → 1px |
| `flex-grow` | 2 | → `grow` |
| `blur` | 1 | → `blur-sm` |

Only **9 lines** carry a border-width utility with no border-colour on the same line, so
Tailwind 4's `currentColor` border default is a nine-site risk, not a 156-site one.

Every raw `rounded` / `rounded-sm` hit in the tree is a comment or a test fixture — the
`semanticRadius` ratchet has already cleared real source.

### What else rides on Tailwind 3

Nothing that broke. All of these ship their own CSS and all of them still work:

- `@excalidraw/excalidraw@0.18.1` — verified by `brainstorms-v2.spec.ts`
- `@xyflow/react@12` — `canvas-edit.spec.ts`, `canvas-edge-label.spec.ts`
- `@xterm/xterm@6` — `terminal-*.spec.ts`, `theme-switch.spec.ts`
- `@pierre/trees@1.0.0-beta.4` — `drill-in.spec.ts`
- `@pierre/diffs@1.2.10` — `library.spec.ts`, project tabs
- `mermaid@11` — builds and chunks as before

One near-miss worth recording so nobody re-investigates it: Excalidraw's CSS *looks* like it
collides with daisyUI 5's new `--border` token. It does not — its property is
`--ExcTextField--border`, a different name.

The build-tool side got simpler rather than harder. `postcss.config.js`, `autoprefixer` and
`postcss` all go away; `@tailwindcss/vite` replaces them, and `fallow audit` flagged both
dependencies as unused the moment the PostCSS pipeline went, which is how they got removed.

The one genuinely new gate failure: **Biome cannot parse `@config`** and fails `biome ci` on
the stylesheet, which then aborts the formatter for the whole run. Fix is one option:

```json
"css": { "parser": { "tailwindDirectives": true } }
```

(and it must go in without a `//` comment beside it — a comment there made Biome silently
process 0 files instead of erroring.)

## 2. The guardrails — `themeCatalog.test.ts` survives, and gets stronger

This was the question that could have killed the upgrade. It does not, because the premise
("under Tailwind 4 that file does not exist") is false: `@config` keeps `tailwind.config.js`
as a real module that both the bundler and `bun test` import. There is still exactly one
declaration of the eight themes, and the gate still reads it.

The port is a loader change plus a token-name change. Every assertion is kept:

| assertion | under daisyUI 5 |
|---|---|
| catalog and config name the same eight themes | unchanged |
| full token set per theme | unchanged, reads `--color-<token>` |
| family shape row, no two families alike | unchanged, minus `--animation-btn`, plus `--border`/`--depth` |
| light and dark share one shape | unchanged |
| `base-content` clears 7:1 on all three bases | unchanged |
| `primary-content` clears 4.5:1 on `primary` | unchanged |
| every ink token clears 4.5:1 on `base-100` | unchanged |
| exemptions still miss the bar | unchanged |
| `darkMode` is the suffix selector | unchanged |
| radius aliases exist | unchanged in shape, now only 2 entries |
| `base: false` | now asserts `exclude` contains `rootcolor` |
| **pidlight/piddark ordering** | **replaced by something better, below** |

Result: **15 tests pass, up from 13.**

Two assertions are genuinely improved rather than merely ported.

**The no-JS fallback stops being positional.** Under daisyUI 4 the invariant was "theme 0
becomes `:root`, theme 1 gets wrapped in the media query", so the fallback depended on array
order that nothing declared, and inserting a family at the top of the list would have silently
moved it. daisyUI 5 makes both facts explicit per theme, so the gate now asserts the thing
where it takes effect and additionally that there is exactly one of each:

```ts
expect(meta.pidlight?.default).toBe(true)
expect(meta.piddark?.prefersdark).toBe(true)
expect(defaults.map(([n]) => n)).toEqual(["pidlight"])
expect(prefersdark.map(([n]) => n)).toEqual(["piddark"])
```

**`themes: false` is now worth asserting.** daisyUI 5 ships a built-in theme actually named
`sunset`. If the repo ever let daisyUI's own themes emit, `[data-theme=sunset]` would collide
with this family's vocabulary. The new test pins `themes: false` alongside the `rootcolor`
exclusion.

One extra assertion came for free: daisyUI 5 emits `color-scheme` into each theme rule, so the
gate can now check that a light theme does not claim `dark` — which is what keeps native
scrollbars and form controls from painting white-on-white.

`terminalTheme.test.ts` is the *second* runtime reader of the config, and it is easy to forget
because the docs only mention the first. It needs the same loader change; nothing else.

## 3. The no-JS `prefers-color-scheme` fallback survives

Verified in built CSS, both before and after.

daisyUI 4 emitted exactly one block:

```css
@media (prefers-color-scheme: dark){:root{--p: 75.35% …}}
```

daisyUI 5 emits exactly one block, gated:

```css
@media (prefers-color-scheme:dark){:root:not([data-theme]){color-scheme:dark;
  --color-primary:#38bdf8;--color-base-100:#020617; …}}
```

Same count, same theme, **better selector**. `:root:not([data-theme])` means the media query
can never fight an explicit `data-theme`; the v4 form used a bare `:root` and relied on
daisyUI emitting the `[data-theme=…]` rules later in the file to win on source order. The
pre-React paint is preserved, and it is now preserved by construction.

It is opt-in, though. It comes from `prefersdark: true` on the theme (or `--prefersdark` in
the CSS `@plugin` form). Forget it and the fallback disappears silently — which is exactly
why it belongs in the gate, as above.

## 4. Do the new knobs buy anything here?

**The three radius tokens: no change, slightly less code.** `--radius-field` vs
`--radius-selector` is a finer *name* than `--rounded-btn`/`--rounded-badge`, not a finer
control — it is still one radius for controls and one for pills. The real win is unrelated to
theming: daisyUI 5 ships all 24 corner-specific forms (`rounded-t-box`, `rounded-tr-field`, …)
that this repo currently hand-registers in `theme.extend.borderRadius`. For `box` that block
becomes redundant and can be deleted.

It cannot be deleted entirely. daisyUI 5 dropped the `badge` and `btn` names, which 126 call
sites here are written against:

| class | sites |
|---|---|
| `rounded-btn` (+ `rounded-tr-btn`) | 90 |
| `rounded-badge` (+ `rounded-bl-badge`) | 36 |
| `rounded-box` (+ corner forms) | 84 (unaffected) |

Two config lines keep all 126 working, which is why the rename is optional:

```js
borderRadius: {
  btn: "var(--radius-field, 0.5rem)",
  badge: "var(--radius-selector, 1.9rem)",
}
```

Verified in built CSS — `.rounded-tr-btn{border-top-right-radius:var(--radius-field,.5rem)}` —
and verified in a browser: `theme-switch.spec.ts` asserts *computed* radii (12px/8px for `pid`,
0px/0px for `terminal`, 16px/12px for `sunset`) and passes unchanged. So
`apps/web/CLAUDE.md`'s claim that this block "is the one place an upgrade has to touch" is
exactly right.

**`--border`: would read as noise here, not design.** It reaches daisyUI component classes
only, and the app splits its surfaces between the two worlds:

- reached: `btn` (259), `tab` (342), `input` (217), `badge` (107), `card` (72), `select` (55),
  `menu` (41), `alert` (14)
- **not** reached: 112 hand-written `border border-base-300` panel outlines, including
  `lib/tabDock.tsx`'s tab dock and side rail

On the specific case raised — #509 removing zellij's status bars leaves the terminal panel more
exposed — `--border` does not help. The pane is
`className="flex-1 min-h-0 rounded-box p-2 shadow-inner"` in `TerminalView.tsx`: it has no
border at all, and its corners already come from `--radius-box`, which works today. The
outline visible around it is the panel wrapper's hand-written 1px `border-base-300`.

Screenshots of `pid`, `mono`, `terminal` and `sunset` on the spike build confirm it: the
families still read as distinct through colour and radius, and a 2px `--border` on `terminal`
changed nothing visible on the surfaces that frame the app.

**`--depth`: a flat/raised switch, not a dial.** It is a 0-or-1 multiplier gating three things
on daisyUI components — an inset highlight (`calc(var(--depth) * 5%)`), a drop shadow
(`0 4px 3px -2px … calc(var(--depth) * 30%)`) and an edge darkening
(`calc(var(--depth) * .15)`). Setting it to 1 makes buttons look mildly skeuomorphic. Same
reach problem as `--border`: panels use Tailwind's `shadow-sm` / `shadow-inner` and would stay
flat while buttons lifted.

Both knobs become interesting only *after* the 112 panel borders read from a token. That is a
worthwhile piece of work and it is independent of this upgrade — it could be done on daisyUI 4
today.

**Net on shape: it is a wash at best.** Three radius tokens where there were three, two new
knobs that cannot reach half the UI, and one working knob (`--animation-btn`) deleted.

## What was run, and what was reasoned about

Run, on the spike branch, output observed:

| command | result |
|---|---|
| `bun install` | clean |
| `apps/web` vite build, before | green, CSS 301.7K |
| `apps/web` vite build, after | green, CSS 328.1K (+8.7%) |
| `bun run typecheck` | clean, 6 projects |
| `bun run lint:ci` | exit 0 (after the Biome option) |
| `bun run test` (incl. `doctor`) | exit 0 — 1745 + 67 + 60 pass, 0 fail |
| `bun run test:web` | 1435 pass, 0 fail |
| `bun run test:cli` | 253 pass, 0 fail |
| `bun run audit` | no issues |
| `bun run axiom-debt` | 70 known, none new |
| **`bun run verify`** | **exit 0** |
| e2e, full suite | **100 passed, 2 skipped**, exit 0 |
| e2e, theme subset | 11/11 |
| e2e, dependency-CSS subset | 21/21 |
| `themeCatalog.test.ts` alone | 15 pass, 271 assertions |
| 4 theme screenshots @1440×900 | render correctly |

e2e ran with `PID_E2E_USE_STUB=1 PID_E2E_DAEMON_PORT=19801 PID_E2E_WEB_PORT=16801`.

Claims read out of installed package source rather than documentation: `--animation-btn`'s
removal (no occurrence anywhere in `daisyui@5.7.8`; `button.css` hardcodes
`transition-duration:.2s`), the `--default` / `--prefersdark` handling
(`functions/pluginOptionsHandler.js`, `theme/index.js`), `rootcolor` as the `base: false`
equivalent (`base/rootcolor.css`), the 24 shipped corner utilities
(`utilities/radius.css`), and which components read `--border` (22) and `--depth` (14).

Reasoned about, not measured:

- The day-scale effort estimate. The spike reached green, but it did not do the optional
  CSS-first rewrite, and it did not repaint the 35 `shadow-sm` / 6 `outline-none` sites the
  v4 scale shift affects — the gates do not assert those pixels, so they passed while looking
  very slightly different. A real PR should walk them.
- Whether a uniform 0.2s button transition is acceptable for `terminal`. That is a design
  call, not a measurement.
- Whether `--depth: 1` on `sunset` is attractive. Judged from one empty-state screenshot with
  few buttons in frame.
