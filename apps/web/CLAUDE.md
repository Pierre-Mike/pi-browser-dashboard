# apps/web — expertise

## Design system: daisyUI semantic tokens (uniform palette)

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
theme name. Per-family terminal colours, and per-family `--rounded-*`, are
deliberately not done: all eight themes share identical shape tokens today
(`lib/ui/themeCatalog.test.ts` asserts it).

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

`src/lib/ui/themeCatalog.test.ts` is the second half: it loads
`tailwind.config.js` at runtime and asserts the catalog and the config name the
same eight themes, that `pidlight`/`piddark` stay first (daisyUI emits theme 0 as
`:root` and theme 1 under `prefers-color-scheme: dark` — the no-JS fallback),
that `darkMode` is still the suffix selector, that every theme carries the full
token set, and that `base-content` clears 7:1 on `base-100/200/300`.

Escape hatch: a line carrying a genuinely-required colour literal opts out with
a trailing `// design-allow: <reason>` comment. Reserved for colour **data**,
not styling. Wholesale-allow-listed files (xterm / Obsidian-canvas colour data):
`features/terminal/terminalTheme.ts`, `features/canvas/canvasObsidian.ts`,
`features/projects/canvasParse.ts`.
