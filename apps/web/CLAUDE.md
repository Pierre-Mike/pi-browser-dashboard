# apps/web — expertise

## Design system: daisyUI semantic tokens (uniform palette + themed shape)

The UI paints with **daisyUI semantic tokens**, never the raw Tailwind palette.
`tailwind.config.js` (`base: false`) declares four theme **families**, each a
light + dark pair: `pid` (`pidlight`/`piddark`), `mono`, `terminal`, `sunset`.
**One semantic class adapts across all eight themes**, which is what replaced the
old hand-written `light dark:` pairs.

### Choosing a theme

`src/lib/ui/theme.core.ts` is the catalog and every decision (`THEME_FAMILIES`,
`THEME_MODES` = `system | light | dark`, `resolveTheme`, `parseStoredTheme`,
`schemeForThemeName`). `src/lib/ui/useTheme.ts` is the only I/O edge: it reads
`localStorage["pid:ui:theme"]` (encoded `"<family>:<mode>"`), subscribes to
`prefers-color-scheme` for `system` mode, and writes `data-theme` +
`style.colorScheme` onto `<html>`. `darkMode` is
`["selector", '[data-theme$="dark"]']`, so the `dark:` variant follows the
*resolved theme name*, not the OS — which is also why every family's dark
variant must keep the `dark` suffix. The choice is per-browser; promoting it to a
machine-wide default in the global-settings file is not done yet.

Because `base: false`, **the app shell paints the page**, not daisyUI. That is
`routes/__root.tsx` (`bg-gradient-to-b from-base-100 to-base-200
text-base-content`). A raw colour literal there — or in the sidebar chrome — is a
surface no theme can reach, which is exactly how it used to be.

The xterm palette (`features/terminal/terminalTheme.ts`) is still one light/dark
pair shared by every family; `TerminalView` picks between them from the resolved
theme name. Per-family terminal colours are deliberately not done yet, and it
shows: in `sunsetdark` the terminal pane is cool navy inside warm plum chrome,
which reads as a hole in the page rather than a panel.

### Shape is a theme property too

A family owns **component form** as well as colour. Each theme sets
`--rounded-box` (panels, cards, modals, popovers, dropdown surfaces, code
blocks), `--rounded-btn` (buttons, inputs, selects, tabs, small controls),
`--rounded-badge` (chips and pills) and `--animation-btn`:

| family | `box` | `btn` | `badge` | `animation-btn` |
|---|---|---|---|---|
| `pid` (default, **byte-frozen**) | `0.75rem` | `0.5rem` | `1rem` | `0.2s` |
| `mono` | `0.25rem` | `0.125rem` | `0.25rem` | `0.1s` |
| `terminal` | `0` | `0` | `0` | `0s` |
| `sunset` | `1rem` | `0.75rem` | `2rem` | `0.3s` |

Both variants of a family share one shape. Changing a family's form is a change
to those four lines and **nothing else** — no component edits.

`theme.extend.borderRadius` in `tailwind.config.js` aliases the three vars into
Tailwind's own radius scale, which is what makes the **corner-specific** forms
work: `rounded-t-box`, `rounded-tr-btn`, `rounded-bl-badge`. daisyUI's `utils`
layer only emits the whole-element `.rounded-box`, so without that block a
`rounded-t-box` is an unknown class that emits no CSS and silently renders
square. daisyUI 4 registers the same three names itself; the repo declares them
anyway, because daisyUI 5 renames the vars to `--radius-box` / `--radius-field`
and that block is the one place an upgrade has to touch.

**Never write a raw radius.** Use the three tokens. `rounded-full` (a circle is
a circle in every family) and `rounded-none` (a deliberate hard square) are the
only literals allowed. Prefer *deleting* a radius over translating it when the
element already carries a daisyUI component class (`btn`, `card`, `input`,
`badge`, `modal-box`, `tab`, `menu`) — those already read the var, so a raw
`rounded-lg` there both duplicates and overrides the theme.

### Canonical mapping (raw → semantic)

| Raw Tailwind | Semantic token |
|---|---|
| `bg-white`, `bg-slate-50`, `bg-slate-950`, `bg-white dark:bg-slate-950` | `bg-base-100` |
| `bg-slate-100`, `bg-white dark:bg-slate-900`, dark `bg-slate-900` | `bg-base-200` |
| `bg-slate-200`, `dark:bg-slate-800`, `bg-slate-800` | `bg-base-300` |
| `border-slate-200/300` (+ `dark:border-slate-700/800`), `/80` variants | `border-base-300` |
| `border-slate-100` | `border-base-200` |
| `text-slate-900/800` (+ dark) | `text-base-content` |
| `text-slate-700/600` | `text-base-content/80` |
| `text-slate-500/400/300` (muted) | `text-base-content/60` |
| `text-white` on a coloured surface | `text-primary-content` (else `text-base-100`) |
| `sky-*` / `blue-*` interactive (buttons, focus rings, links, active tabs) | `primary` |
| `emerald` / `green` | `success` |
| `rose` / `red` | `error` |
| `amber` / `yellow` / `orange` | `warning` |
| `indigo` / `violet` / `purple` | `secondary` |
| `cyan` / `teal` | `info` |
| inverted button `bg-slate-900 … dark:bg-slate-100 …` | `bg-neutral text-neutral-content` |

Tinted state chips use the **`/15` opacity convention**: `bg-{state}/15
text-{state}` (e.g. a green "done" pill → `bg-success/15 text-success`). Status
tones are centralised in `src/lib/format.ts` (`stateColor`) — reuse it, don't
re-derive tone classes per feature.

Prefer daisyUI **component** classes over hand-rolled equivalents:
`btn btn-sm btn-primary` (not `rounded px-3 py-1 bg-sky-600 …`),
`input input-bordered input-sm`, `badge`, `menu`, `tab`.

### Enforcement

`src/lib/ui/semanticPalette.test.ts` scans every `.ts`/`.tsx` under `features/`
**and `routes/`** and **fails on any raw-palette colour utility**. This is the
ratchet — keep it green. `routes/` and plain `.ts` are in scope because the two
worst offenders were a route file (the shell gradient) and a pure class-name
helper (`sessions/navChrome.ts`, the sidebar), neither of which the original
feature-`.tsx`-only scan could see.

`src/lib/ui/semanticRadius.test.ts` is the same ratchet for **shape**: it fails
on any raw `rounded-*` utility outside the allowed set. Its scan roots are
`features/`, `routes/` **and `lib/`** — the third is not speculative. The tab
dock's class strings live in `lib/tabDock.tsx`, and the first square-theme
screenshot showed a fully square page with a rounded pill still floating in the
tab bar, because a features-and-routes-only scan cannot see that file. A shared
class-name helper is a component wherever it is filed. (The palette ratchet does
**not** yet cover `lib/`; it happens to be clean there today.)

Two notes on that test, both learned the hard way. It reads `rounded` as an
ordinary English word, so it blanks comments before scanning — and it must blank
*comments*, not "scan only single-line string literals", which was the first
attempt and failed open on 19 real sites where a `className={`…`}` template
opened on one line and closed on another. And it cannot notice a *missing*
Tailwind alias, because `rounded-t-box` is spelled correctly whether or not any
CSS backs it; `themeCatalog.test.ts` covers that half.

`src/lib/ui/themeCatalog.test.ts` is the config half: it loads
`tailwind.config.js` at runtime and asserts the catalog and the config name the
same eight themes, that `pidlight`/`piddark` stay first (daisyUI emits theme 0 as
`:root` and theme 1 under `prefers-color-scheme: dark` — the no-JS fallback),
that `darkMode` is still the suffix selector, that the three `borderRadius`
aliases are present, that every theme carries the full token set **and its
family's shape row**, that no two families are shaped alike (else one is
colour-only again), and that `base-content` clears 7:1 on `base-100/200/300`.

`apps/e2e/tests/theme-switch.spec.ts` closes it end to end: choosing `terminal`
through the real Appearance picker drives the terminal pane's *computed*
`border-radius` to `0px` and `sunset` drives it to `16px`. Asserting the CSS
variable would prove nothing — a var no element reads is dead.

Escape hatch: a line carrying a genuinely-required colour literal opts out with
a trailing `// design-allow: <reason>` comment. Reserved for colour **data**,
not styling. Wholesale-allow-listed files (xterm / Obsidian-canvas colour data):
`features/terminal/terminalTheme.ts`, `features/canvas/canvasObsidian.ts`,
`features/projects/canvasParse.ts`.
