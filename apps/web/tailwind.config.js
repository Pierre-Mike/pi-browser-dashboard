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
  // ── the pop families ──────────────────────────────────────────────────────
  //
  // The four families above are restrained on purpose. These three are not: they
  // exist to be obviously different at a glance, and every one of them clears
  // the same floors with **no entry in `INK_CONTRAST_EXEMPT`**.
  //
  // The design problem, stated once because all three share it. A token is both
  // a *surface* (`bg-primary` under `text-primary-content`) and *ink*
  // (`text-primary`), and ink has to clear 4.5:1 on `base-100`. On a near-white
  // `base-100` a vivid hue at full lightness cannot: hot pink #ec4899 is 3.19:1,
  // lime #84cc16 is 2.11:1, yellow #facc15 is 1.68:1. The obvious fix —
  // desaturate until it passes — produces exactly the muted palette these
  // families exist not to be.
  //
  // So the light inks are solved instead: for each hue, the **lightest** value at
  // near-maximum chroma that still clears the floor. Saturation is what the eye
  // reads as "pop", not lightness, so #d81064 (4.77:1) is still unmistakably hot
  // pink and #8d40f1 (4.76:1) still electric violet. Two hues cannot survive the
  // trip at all — lime lands olive (#4e7b09) and yellow lands bronze (#886d03) —
  // which is the same place the repo's other light themes already put `warning`
  // (`monolight`/`terminallight` #a16207, `sunsetlight` #b45309), so it is a
  // precedent rather than a new compromise.
  //
  // The vividness the light inks give up is paid back twice. Once on the
  // surfaces, where the token is the background and its `*-content` is the text,
  // so a `btn-primary` is full-strength colour. And once in `base-200`/
  // `base-300`, which are gated only by `base-content`'s 7:1 — there is ~10:1 of
  // headroom there, so they carry a real tint (candy's #ffc2e0, arcade's
  // #d6bcff, citrus's #ffdf8a) instead of the usual near-gray step. Cards, the
  // sidebar and every hover state read as the family.
  //
  // The dark variants have the inverse constraint and therefore no constraint at
  // all: on a near-black `base-100`, ink must be *light*, and light saturated
  // colour is neon. That is where each family is least compromised.
  {
    name: "candylight",
    "color-scheme": "light",
    // #d81064 — 4.77:1 on base-100, the lightest hot pink that clears it.
    "--color-primary": "#d81064",
    "--color-primary-content": "#fff7fb",
    "--color-secondary": "#087a8f",
    // Lime as ink is the hue that cannot survive: this is olive, and the family's
    // actual lime shows up as `bg-accent` and in candydark.
    "--color-accent": "#4e7b09",
    "--color-neutral": "#4a1030",
    "--color-base-100": "#fff7fb",
    "--color-base-200": "#ffdff1",
    "--color-base-300": "#ffc2e0",
    "--color-base-content": "#3d0a24",
    "--color-info": "#116dd7",
    "--color-success": "#108041",
    "--color-warning": "#ac5907",
    "--color-error": "#dc161c",
    "--radius-box": "1.5rem",
    "--radius-field": "1rem",
    "--radius-selector": "2rem",
    // Pillowy and outlined: bubblegum is not a hairline aesthetic.
    "--border": "2px",
    "--depth": "1",
    "--noise": "0",
  },
  {
    name: "candydark",
    "color-scheme": "dark",
    "--color-primary": "#ff5eb0",
    "--color-primary-content": "#1a0620",
    "--color-secondary": "#22d3ee",
    "--color-accent": "#a3e635",
    "--color-neutral": "#3b1140",
    // Deep plum, not near-black: the dark variant of a pink family should still
    // be pink, so every base surface keeps red and blue above green.
    "--color-base-100": "#1a0620",
    "--color-base-200": "#260a2e",
    "--color-base-300": "#35123e",
    "--color-base-content": "#fce7f3",
    "--color-info": "#38bdf8",
    "--color-success": "#4ade80",
    "--color-warning": "#fbbf24",
    "--color-error": "#fb7185",
    "--radius-box": "1.5rem",
    "--radius-field": "1rem",
    "--radius-selector": "2rem",
    "--border": "2px",
    "--depth": "1",
    "--noise": "0",
  },
  {
    name: "arcadelight",
    "color-scheme": "light",
    "--color-primary": "#8d40f1",
    "--color-primary-content": "#faf6ff",
    "--color-secondary": "#cf0d95",
    "--color-accent": "#077a87",
    "--color-neutral": "#26104a",
    "--color-base-100": "#faf6ff",
    "--color-base-200": "#ece0ff",
    "--color-base-300": "#d6bcff",
    "--color-base-content": "#1e0a3c",
    "--color-info": "#3063ee",
    "--color-success": "#107e47",
    "--color-warning": "#9c6107",
    "--color-error": "#da133b",
    // A CRT cabinet: a lightly-radiused bezel around perfectly square controls.
    "--radius-box": "0.375rem",
    "--radius-field": "0",
    "--radius-selector": "0",
    "--border": "2px",
    "--depth": "1",
    "--noise": "0",
  },
  {
    name: "arcadedark",
    "color-scheme": "dark",
    "--color-primary": "#c084fc",
    "--color-primary-content": "#0a0118",
    "--color-secondary": "#ff4fdf",
    "--color-accent": "#34e5ff",
    "--color-neutral": "#241046",
    // The family's reason to exist. Indigo-black rather than neutral black, so
    // the neon sits *in* the cabinet instead of on a void.
    "--color-base-100": "#0a0118",
    "--color-base-200": "#150430",
    "--color-base-300": "#241046",
    "--color-base-content": "#ece2ff",
    "--color-info": "#7dd3fc",
    "--color-success": "#5cf2a0",
    "--color-warning": "#fcd34d",
    "--color-error": "#ff6b8a",
    "--radius-box": "0.375rem",
    "--radius-field": "0",
    "--radius-selector": "0",
    "--border": "2px",
    "--depth": "1",
    "--noise": "0",
  },
  {
    name: "citruslight",
    "color-scheme": "light",
    // Hue 20, not 30. Counter-intuitively, pushing an orange *towards* orange
    // makes it duller here: at a fixed contrast ratio the higher hue has to be
    // darker (h=18 lands #ce4205, h=38 lands #9f6604), so the brightest orange
    // this floor allows sits at the red end of the range.
    "--color-primary": "#ca4705",
    "--color-primary-content": "#fffbf0",
    // The two hues that land off-target: lime -> #527c08, yellow -> #886d03.
    // Both are the lightest value their hue can hold at 4.5:1, and both come
    // back at full strength in citrusdark.
    "--color-secondary": "#527c08",
    "--color-accent": "#886d03",
    "--color-neutral": "#3f2708",
    "--color-base-100": "#fffbf0",
    // Actual lemon, not cream. This is where citrus gets its pop, because the
    // ink floor cannot give it any: at 10.9:1 these are nowhere near
    // `base-content`'s 7:1 limit, and a first pass with a honey-coloured ramp
    // (#ffefc9 / #ffdf8a) read as sepia rather than fruit.
    "--color-base-200": "#ffe9a3",
    "--color-base-300": "#ffd95c",
    "--color-base-content": "#3d2606",
    "--color-info": "#0979a3",
    "--color-success": "#10813a",
    "--color-warning": "#a46007",
    "--color-error": "#de1a13",
    // Chunky and stencilled, flat rather than lifted — the `--depth: 0` is what
    // keeps citrus from reading as a warmer `sunset`.
    "--radius-box": "0.5rem",
    "--radius-field": "0.375rem",
    "--radius-selector": "1.5rem",
    "--border": "2px",
    "--depth": "0",
    "--noise": "0",
  },
  {
    name: "citrusdark",
    "color-scheme": "dark",
    "--color-primary": "#fb923c",
    // Equal to base-100, as in the other five pop themes: text on an orange
    // button is the page it sits on.
    "--color-primary-content": "#120d03",
    "--color-secondary": "#a3e635",
    "--color-accent": "#fde047",
    "--color-neutral": "#3a2a0b",
    // Near-black with a warm bias rather than an actual brown. A first pass at
    // #171006 was light enough to read as coffee, which flattened the fruit
    // colours sitting on it; dropping it here buys the neons ~0.3 of ratio and,
    // more to the point, stops the page reading as sepia.
    "--color-base-100": "#120d03",
    "--color-base-200": "#1e1607",
    "--color-base-300": "#2c220a",
    "--color-base-content": "#fef3c7",
    "--color-info": "#5eead4",
    "--color-success": "#86efac",
    "--color-warning": "#fbbf24",
    "--color-error": "#fca5a5",
    "--radius-box": "0.5rem",
    "--radius-field": "0.375rem",
    "--radius-selector": "1.5rem",
    "--border": "2px",
    "--depth": "0",
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
