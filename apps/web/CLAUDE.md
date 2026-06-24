# apps/web — expertise

## Design system: daisyUI semantic tokens (uniform palette)

Feature UIs paint with **daisyUI semantic tokens**, never the raw Tailwind
palette. The two themes `pidlight` / `piddark` (in `tailwind.config.js`,
`base: false`) define the tokens; `piddark` auto-applies under
`prefers-color-scheme: dark` (`darkMode: "media"`), so **one semantic class
adapts across both themes** and replaces the old hand-written `light dark:`
pairs.

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

`src/lib/ui/semanticPalette.test.ts` scans every feature `.tsx` and **fails on
any raw-palette colour utility**. This is the ratchet — keep it green.

Escape hatch: a line carrying a genuinely-required colour literal opts out with
a trailing `// design-allow: <reason>` comment. Reserved for colour **data**,
not styling. Wholesale-allow-listed files (xterm / Obsidian-canvas colour data):
`terminal/terminalTheme.ts`, `canvas/canvasObsidian.ts`, `projects/canvasParse.ts`.
