import daisyui from "daisyui"
import daisyuiTheme from "daisyui/theme"

// SPIKE (daisyUI 5 / Tailwind 4). The question this file exists to answer:
// can `tailwind.config.js` stay the single runtime-readable source of truth for
// the theme catalog under a CSS-first Tailwind, so `themeCatalog.test.ts` keeps
// its input? Themes are declared as plain data here and registered through
// daisyUI 5's `daisyui/theme` JS plugin, which spreads each object straight into
// a `[data-theme=…]` rule.
//
// Token renames vs daisyUI 4:
//   primary            -> --color-primary        (every colour token gains --color-)
//   --rounded-box      -> --radius-box
//   --rounded-btn      -> --radius-field
//   --rounded-badge    -> --radius-selector
//   --animation-btn    -> REMOVED by daisyUI 5 (button duration is hardcoded .2s)
//   new: --border, --depth, --noise, --size-field, --size-selector
export const THEMES = [
  {
    name: "pidlight",
    default: true,
    "color-scheme": "light",
    "--color-primary": "#0369a1",
    "--color-primary-content": "#f8fafc",
    "--color-secondary": "#4f46e5",
    "--color-accent": "#f59e0b",
    "--color-neutral": "#1e293b",
    "--color-base-100": "#ffffff",
    "--color-base-200": "#f1f5f9",
    "--color-base-300": "#e2e8f0",
    "--color-base-content": "#0f172a",
    "--color-info": "#0369a1",
    "--color-success": "#10b981",
    "--color-warning": "#f59e0b",
    "--color-error": "#f43f5e",
    "--radius-box": "0.75rem",
    "--radius-field": "0.5rem",
    "--radius-selector": "1rem",
    "--border": "1px",
    "--depth": "0",
    "--noise": "0",
  },
  {
    name: "piddark",
    prefersdark: true,
    "color-scheme": "dark",
    "--color-primary": "#38bdf8",
    "--color-primary-content": "#0b1220",
    "--color-secondary": "#818cf8",
    "--color-accent": "#fbbf24",
    "--color-neutral": "#1e293b",
    "--color-base-100": "#020617",
    "--color-base-200": "#0f172a",
    "--color-base-300": "#1e293b",
    "--color-base-content": "#e2e8f0",
    "--color-info": "#38bdf8",
    "--color-success": "#34d399",
    "--color-warning": "#fbbf24",
    "--color-error": "#fb7185",
    "--radius-box": "0.75rem",
    "--radius-field": "0.5rem",
    "--radius-selector": "1rem",
    "--border": "1px",
    "--depth": "0",
    "--noise": "0",
  },
  {
    name: "monolight",
    "color-scheme": "light",
    "--color-primary": "#3f3f46",
    "--color-primary-content": "#fafafa",
    "--color-secondary": "#71717a",
    "--color-accent": "#57534e",
    "--color-neutral": "#18181b",
    "--color-base-100": "#ffffff",
    "--color-base-200": "#f4f4f5",
    "--color-base-300": "#e4e4e7",
    "--color-base-content": "#18181b",
    "--color-info": "#475569",
    "--color-success": "#4d7c0f",
    "--color-warning": "#a16207",
    "--color-error": "#b91c1c",
    "--radius-box": "0.25rem",
    "--radius-field": "0.125rem",
    "--radius-selector": "0.25rem",
    // mono is tight AND thin-lined: a hairline frame reads as technical.
    "--border": "1px",
    "--depth": "0",
    "--noise": "0",
  },
  {
    name: "monodark",
    "color-scheme": "dark",
    "--color-primary": "#d4d4d8",
    "--color-primary-content": "#18181b",
    "--color-secondary": "#a1a1aa",
    "--color-accent": "#d6d3d1",
    "--color-neutral": "#27272a",
    "--color-base-100": "#09090b",
    "--color-base-200": "#18181b",
    "--color-base-300": "#27272a",
    "--color-base-content": "#e4e4e7",
    "--color-info": "#94a3b8",
    "--color-success": "#a3e635",
    "--color-warning": "#fbbf24",
    "--color-error": "#fb7185",
    "--radius-box": "0.25rem",
    "--radius-field": "0.125rem",
    "--radius-selector": "0.25rem",
    "--border": "1px",
    "--depth": "0",
    "--noise": "0",
  },
  {
    name: "terminallight",
    "color-scheme": "light",
    "--color-primary": "#15803d",
    "--color-primary-content": "#fdfbf5",
    "--color-secondary": "#0f766e",
    "--color-accent": "#4d7c0f",
    "--color-neutral": "#1c2b1f",
    "--color-base-100": "#faf6ea",
    "--color-base-200": "#f2ecda",
    "--color-base-300": "#e3dac2",
    "--color-base-content": "#14351f",
    "--color-info": "#0f766e",
    "--color-success": "#15803d",
    "--color-warning": "#a16207",
    "--color-error": "#b91c1c",
    "--radius-box": "0",
    "--radius-field": "0",
    "--radius-selector": "0",
    // A character cell is drawn with a 2px rule and no shadow. This is the
    // knob the spike exists to evaluate.
    "--border": "2px",
    "--depth": "0",
    "--noise": "0",
  },
  {
    name: "terminaldark",
    "color-scheme": "dark",
    "--color-primary": "#4ade80",
    "--color-primary-content": "#04120a",
    "--color-secondary": "#2dd4bf",
    "--color-accent": "#a3e635",
    "--color-neutral": "#14261a",
    "--color-base-100": "#04120a",
    "--color-base-200": "#0a1f12",
    "--color-base-300": "#12331f",
    "--color-base-content": "#86efac",
    "--color-info": "#5eead4",
    "--color-success": "#4ade80",
    "--color-warning": "#fde047",
    "--color-error": "#fca5a5",
    "--radius-box": "0",
    "--radius-field": "0",
    "--radius-selector": "0",
    "--border": "2px",
    "--depth": "0",
    "--noise": "0",
  },
  {
    name: "sunsetlight",
    "color-scheme": "light",
    "--color-primary": "#e11d48",
    "--color-primary-content": "#ffffff",
    "--color-secondary": "#7c3aed",
    "--color-accent": "#ea580c",
    "--color-neutral": "#3b1f2b",
    "--color-base-100": "#fffaf6",
    "--color-base-200": "#fdeee3",
    "--color-base-300": "#f7dcc9",
    "--color-base-content": "#3a1d24",
    "--color-info": "#0e7490",
    "--color-success": "#15803d",
    "--color-warning": "#b45309",
    "--color-error": "#be123c",
    "--radius-box": "1rem",
    "--radius-field": "0.75rem",
    "--radius-selector": "2rem",
    // Soft: no hard rule, lift instead. The other new knob under evaluation.
    "--border": "1px",
    "--depth": "1",
    "--noise": "0",
  },
  {
    name: "sunsetdark",
    "color-scheme": "dark",
    "--color-primary": "#fb7185",
    "--color-primary-content": "#2a0a13",
    "--color-secondary": "#c4b5fd",
    "--color-accent": "#fb923c",
    "--color-neutral": "#3b2430",
    "--color-base-100": "#1a0f16",
    "--color-base-200": "#251621",
    "--color-base-300": "#35202d",
    "--color-base-content": "#fbe3e0",
    "--color-info": "#67e8f9",
    "--color-success": "#6ee7b7",
    "--color-warning": "#fcd34d",
    "--color-error": "#fda4af",
    "--radius-box": "1rem",
    "--radius-field": "0.75rem",
    "--radius-selector": "2rem",
    "--border": "1px",
    "--depth": "1",
    "--noise": "0",
  },
]

// Exported so themeCatalog.test.ts can assert it: `exclude: ["rootcolor"]` is
// daisyUI 5's equivalent of daisyUI 4's `base: false` — rootcolor is the one base
// item that paints :root's background/colour, and dropping it is what leaves the
// shell paint to routes/__root.tsx.
export const DAISYUI_OPTIONS = { themes: false, logs: false, exclude: ["rootcolor"] }

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: ["selector", '[data-theme$="dark"]'],
  // SPIKE probe: daisyUI 5 ships `box` / `field` / `selector` (all 24
  // corner-specific forms), but drops `btn` and `badge` — the two names 126 call
  // sites in this app are written against. If Tailwind 4 still honours a legacy
  // `theme.extend.borderRadius` loaded through `@config`, these two lines are a
  // compat shim that makes the rename optional rather than mandatory.
  theme: {
    extend: {
      borderRadius: {
        btn: "var(--radius-field, 0.5rem)",
        badge: "var(--radius-selector, 1.9rem)",
      },
    },
  },
  plugins: [
    // `themes: false` so none of daisyUI's own 35 themes are emitted, and
    // `exclude: ["rootcolor"]` is the daisyUI-4 `base: false` equivalent — it is
    // the one base item that paints :root's background/colour, so dropping it
    // leaves the shell paint to routes/__root.tsx.
    daisyui(DAISYUI_OPTIONS),
    ...THEMES.map((theme) => daisyuiTheme(theme)),
  ],
}
