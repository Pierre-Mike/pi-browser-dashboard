# apps/web — expertise

## Design system: daisyUI semantic tokens (uniform palette + themed shape)

The UI paints with **daisyUI semantic tokens**, never the raw Tailwind palette.
`tailwind.config.js` (`base: false`) declares four theme **families**, each a
light + dark pair: `pid` (`pidlight`/`piddark`), `mono`, `terminal`, `sunset`.
**One semantic class adapts across all eight themes**, which is what replaced the
old hand-written `light dark:` pairs.

### Choosing a theme

`src/lib/ui/theme.core.ts` is the catalog and every decision (`THEME_FAMILIES`,
`THEME_MODES` = `system | light | dark`, `resolveTheme`, `resolveThemeChoice`,
`schemeForThemeName`). `src/lib/ui/useTheme.ts` is the only I/O edge: it reads
`localStorage["pid:ui:theme"]` (encoded `"<family>:<mode>"`), subscribes to
`prefers-color-scheme` for `system` mode, and writes `data-theme` +
`style.colorScheme` onto `<html>`. `darkMode` is
`["selector", '[data-theme$="dark"]']`, so the `dark:` variant follows the
*resolved theme name*, not the OS — which is also why every family's dark
variant must keep the `dark` suffix.

**Two sources, one precedence.** The choice resolves as **this browser's pick →
the machine-wide default → `pid` + `system`**, per *half* rather than per source,
so a stored `"vaporwave:dark"` still contributes its mode. The machine default is
the `ui: { themeFamily, themeMode }` section of the global-settings file; both
halves are opaque strings there, and `""` or a family this build does not ship
both mean "offer nothing" — the daemon is not the catalog's judge, because the
catalog is coupled to `tailwind.config.js`.

The browser value is an **override, not a cache**: `publishThemeChoice` is the
only path that writes localStorage, so `applyMachineTheme` adopting a new default
cannot overrule a browser whose user already chose. That is also what avoids a
first-paint flash — localStorage is synchronous and painted at *import* time,
while the daemon value arrives a round-trip later and, for anyone with a pick,
changes nothing visible. `useMachineTheme()` (called once, from `__root.tsx`, not
from the Settings tab — the second device is the point and may never open it)
feeds it in.

The Appearance section therefore has two halves that persist to different places:
the two selects save on pick with no daemon round-trip, and a separate **"Set as
this machine's default"** button writes the `ui` section. Separate on purpose — if
every pick rewrote the file, "override" would mean nothing and the default would
just be whatever device changed it last. The section also sits outside the form's
`error` branch, so a daemon that is down cannot also cost you the ability to
switch to a readable theme; `GlobalSettingsView.test.tsx` pins that, and the
form's `toFormPatch` excludes `ui` so a Save cannot revert a default set after
the draft was seeded.

The theme is also reachable from the command palette (`Theme: next family`,
`Theme: Light` …) — `THEME_PALETTE_ACTIONS` / `themeCommandFor` in the core,
registered as `kind: "action"` rows in `features/palette/palette.ts`.

Because `base: false`, **the app shell paints the page**, not daisyUI. That is
`routes/__root.tsx` (`bg-gradient-to-b from-base-100 to-base-200
text-base-content`). A raw colour literal there — or in the sidebar chrome — is a
surface no theme can reach, which is exactly how it used to be.

### The xterm pane is a ninth surface, keyed by theme name

`features/terminal/terminalTheme.ts` holds **eight palettes, one per theme**,
keyed by the resolved daisyUI name; `TerminalView` passes `useTheme().resolved`
straight in. It used to be one light/dark pair shared by every family, and that
showed: `terminaldark` wrapped a slate-blue terminal in a phosphor-green shell
and `sunsetdark` put a cool navy pane inside warm plum chrome, which read as a
hole in the page rather than a panel.

xterm paints its own canvas from hex values, so this is the one surface a
semantic token cannot reach — `bg-base-100` stops at the pane's border. Hence the
wholesale allow-list in the palette ratchet: these literals are colour *data*.
The module stays pure (no DOM, unit-testable under bun) and the lookup is
**total** — an unrecognised theme name falls back to `pid` by the same `dark`
suffix the CSS `dark:` variant keys on, so it paints rather than handing xterm an
undefined theme.

Four rules hold every palette together, all asserted by
`terminalTheme.test.ts`:

- **The pane sits between its theme's `base-100` and `base-200`, per channel.**
  Checkable rather than a matter of taste, and read from `tailwind.config.js` at
  runtime, so a new family cannot forget. `pid` already satisfied it (`#f8fafc`
  is exactly halfway between `#ffffff` and `#f1f5f9`), which is why its pane
  never looked wrong; a palette copied from `pid` into another family fails on
  every channel at once.
- **Foreground clears 4.5:1 on background; every ANSI *ink* slot clears 3:1.**
  ANSI `black` is exempt by construction — it is a background slot (xterm's own
  default is `#000000`, 1:1 against any dark pane) and is only required to
  differ from the pane. **There is no by-name exemption list any more.**
  `pidlight.brightYellow` (2.81:1) and `pidlight.brightWhite` (2.45:1) used to
  be on one, because `pid` was byte-frozen; both were darkened along their own
  hue instead (`#b67c04`, 3.42:1 and `#7c8ca2`, 3.27:1) and the list was deleted.
- **The cursor is the theme's `primary`**, asserted against
  `tailwind.config.js`. Seven palettes already did this; `pidlight` was the
  exception, carrying a sky-600 caret under a sky-500 primary because the primary
  was too light to sit on the pane. Fixing the primary removed the reason, so the
  coincidence became an invariant a new family cannot forget.
- **Every light palette overrides all sixteen slots**, `white`/`brightWhite`
  as grays: xterm's defaults assume a dark background, and white-on-light is
  invisible. `piddark` is the one theme allowed to declare none, and it is the
  file's only remaining exemption. The reason is no longer "it shipped that way"
  — that expired with the freeze — but a measured trade-off: xterm's dark
  defaults are legible on `#0b1220` (worst ink slot `brightBlack` `#666666` at
  3.26:1, then ANSI red `#cd3131` at 3.64:1, everything else above 3.8), so there
  is no accessibility debt, and declaring sixteen slate/sky replacements would
  repaint every character of the app's **default dark terminal** for zero
  legibility gain. That is a palette redesign with its own before/after.

A family's palette also has to *read* as that family, so the test pins the
character too: `terminal`'s ink is green-dominant and its `blue`/`brightBlue`
lean teal (a phosphor tube has no blue in it), `mono` keeps pane and ink
near-grayscale while `red` stays hue-identifiable — desaturate, don't erase, or a
build failure stops reading as an error — and `sunset`'s pane is warm where
`pid`'s is cool.

`apps/e2e/tests/theme-switch.spec.ts` closes it end to end: switching family
through the real Appearance picker repaints the pane live, and each assertion
names the family it exercises. `terminal-light-mode.spec.ts` owns the `pid` pair
(`rgb(11,18,32)` / `rgb(248,250,252)`) and asserts `data-theme` alongside them,
so a pane that fell back to `pid` can no longer pass as its own family.

### Shape is a theme property too

A family owns **component form** as well as colour. Each theme sets
`--rounded-box` (panels, cards, modals, popovers, dropdown surfaces, code
blocks), `--rounded-btn` (buttons, inputs, selects, tabs, small controls),
`--rounded-badge` (chips and pills) and `--animation-btn`:

| family | `box` | `btn` | `badge` | `animation-btn` |
|---|---|---|---|---|
| `pid` (default, shape **frozen**) | `0.75rem` | `0.5rem` | `1rem` | `0.2s` |
| `mono` | `0.25rem` | `0.125rem` | `0.25rem` | `0.1s` |
| `terminal` | `0` | `0` | `0` | `0s` |
| `sunset` | `1rem` | `0.75rem` | `2rem` | `0.3s` |

Both variants of a family share one shape. Changing a family's form is a change
to those four lines and **nothing else** — no component edits.

`pid`'s *shape tokens* are frozen; its *pixels* are not. The migration mapped each
element by **role** (panel → `box`, control → `btn`, chip → `badge`), and
Tailwind's scale never lined up with daisyUI's tokens — `rounded-lg` is `0.5rem`
where `--rounded-btn` is also `0.5rem`, but `--rounded-box` is `0.75rem`. So a
panel that was `rounded-lg` (8px) is now 12px. That is intended: preserving
every old literal would have meant a token per accident.

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
colour-only again), that `base-content` clears 7:1 on `base-100/200/300`, and
the two contrast floors below.

`apps/e2e/tests/theme-switch.spec.ts` closes it end to end: choosing `terminal`
through the real Appearance picker drives the terminal pane's *computed*
`border-radius` to `0px` and `sunset` drives it to `16px`. Asserting the CSS
variable would prove nothing — a var no element reads is dead.

Escape hatch: a line carrying a genuinely-required colour literal opts out with
a trailing `// design-allow: <reason>` comment. Reserved for colour **data**,
not styling. Wholesale-allow-listed files (xterm / Obsidian-canvas colour data):
`features/terminal/terminalTheme.ts`, `features/canvas/canvasObsidian.ts`,
`features/projects/canvasParse.ts`.

### Contrast is a gate, not a review note

A token is legible in **both directions** or it is not legible. `primary` is a
*surface* under `primary-content` in a button and *ink* via `text-primary` in a
link, an active tab, a focus ring and a count pill — 38 sites — so two tests,
both in `themeCatalog.test.ts`:

- `primary-content` clears 4.5:1 on `primary`, every theme, **no exemptions**.
- every ink token (`primary`, `secondary`, `accent`, `info`, `success`,
  `warning`, `error`) clears 4.5:1 on `base-100`.

`base-100` and not the whole shell gradient, because `sunsetlight` sits at 4.14
on `base-200` — widening the bar is a change to three families, not a floor they
already meet.

**`pid`'s colour freeze is over.** It was real and it was useful: holding the
default byte-identical while the seven newer themes were built meant a palette
regression could never be blamed on the machinery. But all seven then cleared AA
on their accent while the machine-wide default did not, at 2.77:1 for
`text-primary` on white — and the machine-default work made that worse by
propagating `pid`/`light` to every device instead of one browser. The accent trio
was darkened along its own hue, nothing else moved:

| token | before | after | on `base-100` | on `primary` |
|---|---|---|---|---|
| `primary` / `info` | `#0ea5e9` sky-500 | `#0369a1` sky-700 | 2.77 → **5.93** | 2.65 → **5.67** |
| `secondary` | `#6366f1` indigo-500 | `#4f46e5` indigo-600 | 4.47 → **6.29** | — |

sky-600 (`#0284c7`) is **not** enough — 4.10 on white, 3.91 under
`primary-content`. Verify the ratio; do not assume a Tailwind step clears the bar.

The xterm pane moved with it: `cursor` `#0284c7` → `#0369a1` (3.91 → 5.67),
`brightYellow` `#ca8a04` → `#b67c04` (2.81 → 3.42), `brightWhite` `#94a3b8` →
`#7c8ca2` (2.45 → 3.27). Both **backgrounds** stay frozen.

Four measured misses remain, named in `INK_CONTRAST_EXEMPT` with their ratios:
`pidlight`'s three status hues (`accent`/`warning` `#f59e0b` at 2.15,
`success` `#10b981` at 2.54, `error` `#f43f5e` at 3.67) and `sunsetlight.accent`
(`#ea580c` at 3.43). Deferred, not waived: a status colour carries meaning — a
"blocked" pill has to read differently from a "failed" one at a glance in the
sidebar — so darkening the set changes what the app *communicates* and wants its
own before/after. A companion test asserts each entry **still misses** the bar, so
a repaid exemption fails the build instead of lingering as a stale comment.
