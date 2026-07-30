# apps/web — expertise

## Design system: daisyUI semantic tokens (uniform palette + themed shape)

The UI paints with **daisyUI semantic tokens**, never the raw Tailwind palette.
`tailwind.config.js` (`base: false`) declares nine theme **families**, each a
light + dark pair. Four are restrained by design — `pid` (`pidlight`/`piddark`),
`mono`, `terminal`, `sunset` — and five are deliberately saturated: `candy`,
`arcade`, `citrus`, `prism`, `neon`. **One semantic class adapts across all
eighteen themes**, which is what replaced the old hand-written `light dark:`
pairs.

`prism` is the odd one out, and usefully so. Every family except `neon` is built
around one or two hues and tints its base surfaces to match; `prism` holds
**six hues at maximum chroma at once**, from a reference palette of
`#ff3d00` / `#ffea00` / `#00e676` / `#00b0ff` / `#d5006d` plus `#00e5ff`. That
palette turns out to be an *ANSI* palette — six saturated hues, six slots already
named for them — which is why `prismdark`'s terminal is the most faithful in the
repo, carrying all six verbatim.

**Its chrome is a two-hue wash, and that is a correction worth reading.** The
first version gave `prism` neutral bases, reasoning that a family with six equal
hues cannot tint its surfaces without promoting one. Screenshots killed it: five
of the six hues live in `success` / `warning` / `error` / `info`, tokens that only
paint when a session has something to report, so an **idle dashboard showed
exactly one colour** and `prismlight` was indistinguishable from `mono` with a
pink accent. Colour has to sit where it is always visible, so `base-100` →
`base-200` now washes across two hues (lemon-white to pale cyan; violet-black to
teal-black) and `base-300` — at `--border: 3px`, the outline on every card — is a
real pink rather than a gray step. `themeCatalog.test.ts` asserts both stops carry
a hue *and* that they differ, because flattening them back to neutral is the
specific regression that already happened once.

`neon` is the answer to the question `prism` raised and only half-answered:
**if the always-painted surfaces are where colour has to live, how bright can
those surfaces actually be?** Much brighter than `prism` assumed. The only gate
on `base-100` / `base-200` / `base-300` is `base-content` at 7:1, and that is a
*distance*, not a colour — read the other way it is a licence to put the ink at
one extreme and make the surface a fully saturated hue at the other. So
`neonlight` is a highlighter rather than a tinted white: `base-100` is electric
lemon `#f5ff00` and `base-200` electric cyan `#00f0ff`, both at channel spread
255, measuring 18.35:1 and 14.26:1 against near-black ink and so nowhere near
the limit. `prismlight`'s wash, the previous high-water mark for a coloured
shell, sat at spreads of 10 and 23.

Two findings from `neon` are worth not re-deriving, and both came from a browser
rather than from a contrast table.

**`base-100` is ~75% of the painted pixels, and nothing else is close.** Measured
on a real dashboard at 1440x900: `base-100` 977,772 px², the next surface 38,080,
and `base-300` — the card outline — 16,984 at the **1px** Tailwind `border` the
cards actually use, not the family's `--border`. (`--border` reaches daisyUI's own
components: `btn`, `input`, `badge`, `tab`, `modal-box`.) So a family that spends
its budget on accents or on the border width is optimising ~2% of the screen. Put
it in `base-100`.

**A border is only as visible as its difference from the surface behind it, not
as visible as its own chroma.** `neondark` first shipped `base-300` as electric
violet `#5200f0` — spread 240, the most chromatic value a 7:1 border can hold
anywhere in this file — and on an indigo `base-100` it was *invisible* in the
screenshot. Deep magenta `#9c005c` at spread 156 is less saturated and far more
visible. The gate therefore pins **distinct dominant channels** across
`base-100`/`base-200`/`base-300` rather than a chroma threshold on each: lemon /
cyan / pink light, indigo / teal / magenta dark, so an idle page shows one hue per
RGB channel with nothing running and no status token painted. `prism` reaches
two.

**The dark variant is bounded, and it is worth knowing where.** Raising
`base-100` brightens the page and raises the ink floor in the same move, and the
first ink token to fall off is `error`: at `#16006e` (luminance 0.013) a genuine
red still clears at 4.62 (`#ff3348`); a stop or two brighter and red becomes
coral. Since a theme that cannot say "failed" in red has traded away the wrong
thing — the same argument `mono`'s "desaturate, don't erase" rule makes — that is
where the climb stops, at 3.4x `prismdark`'s base-100 luminance and 4.2x its
chroma. It follows that **no dark theme is bright in its surfaces**; its colour
is in the ink and the terminal, where `neondark` carries seven distinct electric
hues (one more than `prism`'s six) and a pane whose six ANSI hue slots are all
*pure* channel triples. The honest summary is that `neonlight` is the bright one
and `neondark` is the colourful one.

### Adding a family: generate it, then review it on one page

Nine families in, the cost of a tenth was about thirty minutes and only ~5 of
those were design. The other 25 were spent three ways, and each has a tool now.

**`bun run scaffold:theme <family> --label … --hues … --shape …`** generates one.
It solves every ink token, writes both variants, all 32 ANSI slots, the catalog
entry, the shape row and the two palettes, and `bun run theme:check` passes
immediately afterwards — so any failure you then see is yours. `--dry-run` solves
and prints the measured table without writing, which is the mode to hunt hues in.

The solver is the part worth committing, because it had been written ad hoc and
thrown away **three times** — once for `candy`/`arcade`/`citrus`, once for
`prism`, once for `neon` — and each rewrite re-derived the same two sentences. A
vivid hue cannot be ink at full lightness (hot pink `#ec4899` is 3.19:1 on white,
lime `#84cc16` 2.11, yellow `#facc15` 1.68), and the reflex fix of desaturating
until it passes produces exactly the muted palette a pop family exists not to be.
So: **drop lightness, never saturation** — take the value nearest `L = 0.5` (the
maximum-chroma point at `S = 1`) that still clears the floor, which is a bisection
because contrast is monotone in lightness either side of it. That is the whole of
`scripts/theme-solve.core.ts`.

Three things it is careful about, all of them lessons from the families above:

- **The floor is that variant's own `base-100`, never white.** `neon` proved this
  cuts the unexpected way — its electric lemon page is *darker* than white by
  luminance, so a hue solved against `#ffffff` ships one step too light and misses.
- **The pane is stricter than the page.** The pane sits between `base-100` and
  `base-200` (by construction: it is their per-channel midpoint), so anything that
  has to be legible in the terminal — the cursor, which *is* the theme's primary,
  and every ANSI ink slot — is solved against the pane.
- **A bright ANSI slot is derived from its base slot's lightness, not from a second
  looser floor.** With two floors, every yellow, green and cyan on a near-black
  pane clears both at `L = 0.5` and solves to the *same hex twice*, silently
  costing the palette eight slots.

`scripts/theme-emit.core.ts` holds the six insertion anchors, and its co-located
test reads the six **real** files — so a refactor that moves an anchor is a red
`bun run test`, not a scaffold that writes a broken family months later.

**`bun run theme:check`** is the inner loop: the four files a theme change has to
satisfy (`themeCatalog`, `theme.core`, `semanticPalette`, `terminalTheme`), 0.1s
against `bun run verify`'s ~36s. It takes no `--family` filter on purpose — every
contrast floor is *one* test looping over all eighteen themes, so a name filter
would skip the assertions a new hex is most likely to break, and the failure
messages already name the theme.

**`/theme-lab`** replaces the five-views-times-two-variants screenshot pass with
one page. Each panel scopes itself with `data-theme`, so every family and both
variants paint at once, and the **state chips render in two columns, idle and
reporting, side by side**. That pair is the point rather than a detail: it is the
review that rejected `prism`'s first version, and reading only the left column is
exactly the mistake. Two things the lab found about itself on its first
screenshot, both worth not re-deriving: a bare `.modal-box` renders *invisible*
(daisyUI's `.modal` is `opacity: 0` until `.modal-open`, and the box inherits it —
hence `modal modal-open static`), and daisyUI 5 renamed the menu highlight to
`menu-active`, a rename that fails by rendering an unhighlighted row forever.

The lab is a real file-based route, reachable through `routeTree.gen.ts`, and that
is deliberate: a dev-only `import.meta.env.DEV` guard leaves the module imported
and the component body unreachable, which is the shape `fallow audit`'s dead-code
check fails on. It passes the palette and radius ratchets like any other route —
which a page whose whole job is rendering the palette had better do first.

What none of this does is write the design story. A generated family is *correct*,
not designed: retune by taste, then replace the generated character rule in
`terminalTheme.test.ts` with the sentence the family is actually for, and give it
a paragraph above.

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

`features/terminal/terminalTheme.ts` holds **one palette per theme**,
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

The three pop families are pinned the same way, and each rule is a channel
*ordering* rather than "has some colour in it", because `sunset` is the near miss
they all have to stay clear of: `candy`'s pane is magenta-leaning (red **and**
blue over green — `sunset` is warm, so its red beats its blue), `arcade`'s is
blue-dominant with violet-tinted neutrals rather than a stock gray ramp on a
purple background, and `citrus`'s is strictly `r > g > b` with **lime, not
emerald**, greens. A family with no character assertion can silently drift into a
copy of another one; adding a family means adding its rule.

`neon`'s two rules go one step past `prism`'s and are the sharpest in the file.
`neondark`'s six hue slots are each a **pure channel triple** — one channel at 0
and one at 255, so spread is exactly 255 and no value at that hue is more
saturated. `prismdark` manages four of six by accident of its reference palette;
this is all six by construction, and on `#0d1a52` the tightest still measures
4.30:1. The pane is deliberately at the *dark* end of what the between-the-stops
rule allows, because spending its ~0.09 of available luminance would push the 3:1
ANSI floor above what a pure red can reach — the purity and a bright pane are the
same budget. `neonlight`'s rule is the opposite half: its pane is a **saturated
colour** (spread 158) where every other light pane here is a near-white
(`pidlight` 4, `prismlight` 5, `citruslight` 51 at the top end). That is not a
free choice either — the wash pins the pane's green channel into 240..255, so a
bright spring green is the only thing the rule permits, and it happens to be the
honest blend of a lemon `base-100` and a cyan `base-200`.

`prism`'s rule is the inverse of `mono`'s: where `mono` desaturates its ANSI hues
onto near-gray paper, `prism` holds all six at full chroma (channel spread ≥ 112).
The tightest real value is `prismlight.yellow` at 130, because a yellow dark
enough to clear 3:1 on light paper sheds chroma faster than any other hue; every
dark slot is above 210. The *other* half of prism's character — that its shell
gradient crosses two hues — is asserted in `themeCatalog.test.ts` instead, next to
the config data it has to read.

`apps/e2e/tests/theme-switch.spec.ts` closes it end to end: switching family
through the real Appearance picker repaints the pane live, and each assertion
names the family it exercises. `terminal-light-mode.spec.ts` owns the `pid` pair
(`rgb(11,18,32)` / `rgb(248,250,252)`) and asserts `data-theme` alongside them,
so a pane that fell back to `pid` can no longer pass as its own family.

**There is no tenth surface, because the tenth one was deleted.** For a while the
pane had three rows nothing here could reach: zellij's own tab bar and status bar,
drawn by plugin panes *inside the pty* from **zellij's** dark theme, so all four
light themes showed a light terminal with a black strip top and bottom. The fix
was on the daemon side and it was a subtraction — the layouts in
`apps/daemon/src/features/terminal/terminal.core.ts` no longer ask for those
plugin panes. A zellij session is server-side and shared while the theme is a
per-browser choice, so no per-viewer zellij theme can be right for two browsers on
one pty; removing the chrome is the only fix that is theme-independent by
construction. Full reasoning and the 0.44.3 measurements are in AGENTS.md under
"Zellij paints no chrome". If you find yourself wanting to add a palette entry for
a row *the terminal program did not write*, that is the sign to delete the row
instead.

### Shape is a theme property too

A family owns **component form** as well as colour. Each theme sets
`--radius-box` (panels, cards, modals, popovers, dropdown surfaces, code
blocks), `--radius-field` (buttons, inputs, selects, tabs, small controls),
`--radius-selector` (chips and pills), `--border` and `--depth`. (Under daisyUI 4
the first three were `--rounded-box` / `--rounded-btn` / `--rounded-badge` and
there was a fourth knob, `--animation-btn`; v5 hardcodes the button transition
and adds `--border` / `--depth` in its place, so the row is still five wide and
still tells every family apart.)

| family | `radius-box` | `radius-field` | `radius-selector` | `border` | `depth` |
|---|---|---|---|---|---|
| `pid` (default, shape **frozen**) | `0.75rem` | `0.5rem` | `1rem` | `1px` | `0` |
| `mono` | `0.25rem` | `0.125rem` | `0.25rem` | `1px` | `0` |
| `terminal` | `0` | `0` | `0` | `2px` | `0` |
| `sunset` | `1rem` | `0.75rem` | `2rem` | `1px` | `1` |
| `candy` | `1.5rem` | `1rem` | `2rem` | `2px` | `1` |
| `arcade` | `0.375rem` | `0` | `0` | `2px` | `1` |
| `citrus` | `0.5rem` | `0.375rem` | `1.5rem` | `2px` | `0` |
| `prism` | `0.25rem` | `0.25rem` | `0.25rem` | `3px` | `0` |
| `neon` | `1.25rem` | `2rem` | `2rem` | `4px` | `1` |

Both variants of a family share one shape. Changing a family's form is a change
to those five lines and **nothing else** — no component edits.

The gate requires the nine rows to be **distinct as whole tuples**, and the five
newest lean on `border` and `depth` to earn that rather than on radius alone:
`candy` is the roundest box in the set with a 2px sticker outline, `arcade` is a
lightly-radiused CRT bezel around perfectly square controls and chips, `citrus`
is chunky mid-round but **flat** — the `depth: 0` is what stops it reading as a
warmer `sunset` — `prism` is a swatch card: one radius for every role (the
only family that does that) behind the set's only 3px rule, flat, because a
lifted swatch is a button — and `neon` is bent glass, the only family whose
controls are *rounder than its panels* (`field` 2rem over `box` 1.25rem, so every
button and input is a tube end) behind the set's thickest rule at 4px.

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
same eighteen themes, that `pidlight`/`piddark` stay first (daisyUI emits theme 0 as
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
  `warning`, `error`) clears 4.5:1 on `base-100` — every theme, **no exemptions
  either**, since the last four were repaid (below).

`base-100` and not the whole shell gradient, because `sunsetlight` sits at 4.14
on `base-200` — widening the bar is a change to three families, not a floor they
already meet.

**A vivid family clears that floor by dropping lightness, never saturation.** This
is the whole design problem of `candy` / `arcade` / `citrus` / `prism`, and the
reason none of them needed an exemption. A hue at full lightness simply cannot be ink on a
near-white surface — hot pink `#ec4899` is 3.19:1, lime `#84cc16` 2.11:1, yellow
`#facc15` 1.68:1 — and the reflex fix, desaturating until it passes, produces
exactly the muted palette the families exist not to be. So each light ink token is
the **lightest value at that hue and near-maximum chroma that still clears 4.5:1**:
`#d81064` (4.77) is still unmistakably hot pink, `#8d40f1` (4.76) still electric
violet. Saturation is what the eye reads as pop; lightness is what the gate reads.

Two hues do not survive the trip in recognisable form — lime lands olive
(`#4e7b09`) and yellow lands bronze (`#886d03`) — which is where every other light
theme already puts `warning` (`monolight` / `terminallight` `#a16207`,
`sunsetlight` `#b45309`), so it is precedent, not a new compromise. What those
tokens give up as ink comes back on the **surfaces**, where the token is the
background under its `*-content` and a `btn-primary` is full-strength colour, and
in `base-200` / `base-300`, which only `base-content`'s 7:1 constrains — there is
~10:1 of headroom, so they carry a real tint (`candy` `#ffc2e0`, `arcade`
`#d6bcff`, `citrus` `#ffd95c`) instead of the usual near-gray step. `citrus` is
the family that proves this is load-bearing rather than decorative: it has the
least ink headroom of the three, its first pass used a honey ramp
(`#ffefc9` / `#ffdf8a`), and it read as sepia until the ramp became actual lemon.
Two other citrus findings worth not re-deriving — pushing an orange *towards*
orange makes it duller (at a fixed ratio, hue 18 lands `#ce4205` and hue 38
`#9f6604`, so the brightest legal orange is at the red end), and its dark
`base-100` had to drop from `#171006` to `#120d03` because a brown light enough
to read as brown flattens every fruit colour sitting on it. The dark
variants have the inverse constraint and so effectively none: on a near-black
`base-100` ink must be *light*, and light saturated colour is neon, which is why
each family is least compromised in its dark variant.

`prism` is the cleanest demonstration of that asymmetry, because it started from
fixed reference hexes and so measures the gap exactly. On its near-black
`base-100` **five of its six reference hues clear the ink floor untouched** (5.50
to 15.81); only the magenta `#d5006d` misses, at 3.76, and it moved the minimum
distance to `#f5008a` while staying on hue (329 → 328). Against the light
variant's `base-100` the *same six hues* measure 1.23 (`#ffea00`) to 5.12
(`#d5006d`) — one passes, five do not. Same palette, same floor, opposite outcome.

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

**`INK_CONTRAST_EXEMPT` is empty, and the set is deleted rather than emptied.**
The four measured misses it held were all light-theme *status* hues — `pidlight`'s
`accent`/`warning` `#f59e0b` at 2.15, `success` `#10b981` at 2.54, `error`
`#f43f5e` at 3.67, and `sunsetlight.accent` `#ea580c` at 3.43. They were deferred
rather than waived for a real reason: a status colour carries meaning, a "blocked"
pill has to read differently from a "failed" one at a glance in the sidebar, so
darkening the set changes what the app *communicates* and wanted its own
before/after rather than riding along on the accent fix. That before/after is now
done, with `scripts/theme-solve.core.ts` doing the solving — the same rule every
other family's light ink already follows:

| token | before | after | ratio | chroma spread | hue |
|---|---|---|---|---|---|
| `pidlight.accent` / `warning` | `#f59e0b` | `#a26907` | 2.15 → **4.61** | 234 → 155 | 38 → 38 |
| `pidlight.success` | `#10b981` | `#0c855d` | 2.54 → **4.64** | 169 → 121 | 160 → 160 |
| `pidlight.error` | `#f43f5e` | `#e80d33` | 3.67 → **4.63** | 181 → **219** | 350 → 350 |
| `sunsetlight.accent` | `#ea580c` | `#c64a0a` | 3.43 → **4.62** | 222 → 188 | 21 → 20 |

`accent` and `warning` stay one value in `pidlight`, as they were: the family
aliases them deliberately (`stateColor` maps `blocked`/`needs_input` to `warning`
and nothing maps to `accent` at all — three `text-accent` sites total), so
splitting them would invent a distinction the UI does not make.

Two things worth not re-deriving. **The ~0.1 margin over 4.5 is deliberate.** The
exact-floor solutions land at 4.50–4.53 and amber cleared the bar by 0.002, which
is inside a single 8-bit step — a rounding change or a `base-100` tweak would flip
it. Buying the margin cost 2–3 points of channel spread out of 155–222, invisible
at chip size. **And `error` came out *more* chromatic, not less** (spread 181 →
219): rose-500 is a washed rose, and darkening toward hue 349 raises chroma, so the
token that most needs to read as alarming is the one that improved most.

**The surface half of these four tokens is still unmeasured, and that is now the
open gap.** Only `base-content` and `primary-content` are declared, in all
eighteen themes; `accent-content` / `success-content` / `warning-content` /
`error-content` are declared *nowhere*, so daisyUI's `--btn-fg:
var(--color-warning-content)` is invalid-at-computed-value and `btn-warning`,
`badge-warning` and `alert-warning` paint inherited `base-content` on the token.
Measured across the catalog, **68 of those 72 cells already miss 4.5:1** — every
theme but `pidlight`, which passed all four only because its status hues were the
light Tailwind-500 values that failed the *ink* test. So this change moves
`pidlight`'s surface half from 4.86–8.31 down to ~3.86, joining the seventeen
themes already there; it does not create the gap. Closing it properly is 72 token
declarations plus a gate, in both directions, which is its own before/after — the
same argument that deferred these four ink misses in the first place.
