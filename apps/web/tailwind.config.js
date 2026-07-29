import daisyui from "daisyui"

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  // The theme is a runtime choice, not an OS reading: `useTheme` writes the
  // resolved daisyUI theme name into <html data-theme="…">, and every family
  // suffixes its dark variant with "dark" — so one selector drives the `dark:`
  // variant for all of them. `system` mode still follows
  // prefers-color-scheme, but it does so by resolving to a name, not by
  // letting the media query decide behind the app's back.
  darkMode: ["selector", '[data-theme$="dark"]'],
  theme: {
    extend: {},
  },
  plugins: [daisyui],
  // daisyUI gives us a coherent component layer (btn / tab / menu / badge /
  // card) on top of Tailwind. We keep `base: false` so daisyUI never paints
  // the global background/foreground — the app shell (routes/__root.tsx) paints
  // it with base tokens instead, which is what lets a theme change the page
  // background at all.
  //
  // Themes come in *families*: one light + one dark variant each, catalogued in
  // src/lib/ui/theme.core.ts (themeCatalog.test.ts fails if the two drift).
  // Order is load-bearing — daisyUI emits theme 0 as `:root` and theme 1 inside
  // `@media (prefers-color-scheme: dark)` (because of `darkTheme` below), with
  // every theme also emitted as `[data-theme=…]`. So pidlight/piddark must stay
  // first and stay in that order: they are the no-JS fallback.
  //
  // `--rounded-*` and `--animation-btn` are deliberately identical across all
  // eight themes: a family changes colour only. Per-family radius is a separate
  // change, so a shape regression is never confused with a palette one.
  daisyui: {
    base: false,
    styled: true,
    utils: true,
    logs: false,
    darkTheme: "piddark",
    themes: [
      {
        pidlight: {
          primary: "#0ea5e9", // sky-500
          "primary-content": "#f8fafc",
          secondary: "#6366f1", // indigo-500
          accent: "#f59e0b", // amber-500
          neutral: "#1e293b", // slate-800
          "base-100": "#ffffff",
          "base-200": "#f1f5f9", // slate-100
          "base-300": "#e2e8f0", // slate-200
          "base-content": "#0f172a", // slate-900
          info: "#0ea5e9",
          success: "#10b981",
          warning: "#f59e0b",
          error: "#f43f5e",
          "--rounded-box": "0.75rem",
          "--rounded-btn": "0.5rem",
          "--rounded-badge": "1rem",
          "--animation-btn": "0.2s",
        },
      },
      {
        piddark: {
          primary: "#38bdf8", // sky-400
          "primary-content": "#0b1220",
          secondary: "#818cf8", // indigo-400
          accent: "#fbbf24", // amber-400
          neutral: "#1e293b",
          "base-100": "#020617", // slate-950
          "base-200": "#0f172a", // slate-900
          "base-300": "#1e293b", // slate-800
          "base-content": "#e2e8f0", // slate-200
          info: "#38bdf8",
          success: "#34d399",
          warning: "#fbbf24",
          error: "#fb7185",
          "--rounded-box": "0.75rem",
          "--rounded-btn": "0.5rem",
          "--rounded-badge": "1rem",
          "--animation-btn": "0.2s",
        },
      },
      {
        // mono — deliberately restrained. Zinc ink on paper, no accent hue to
        // compete with content. The four state colours stay hue-distinct (a
        // "done" pill has to read differently from a "failed" one) but are
        // pulled down to the darkest, least saturated shade that still holds.
        monolight: {
          primary: "#3f3f46", // zinc-700
          "primary-content": "#fafafa", // zinc-50
          secondary: "#71717a", // zinc-500
          accent: "#57534e", // stone-600
          neutral: "#18181b", // zinc-900
          "base-100": "#ffffff",
          "base-200": "#f4f4f5", // zinc-100
          "base-300": "#e4e4e7", // zinc-200
          "base-content": "#18181b", // zinc-900
          info: "#475569", // slate-600
          success: "#4d7c0f", // lime-700
          warning: "#a16207", // yellow-700
          error: "#b91c1c", // red-700
          "--rounded-box": "0.75rem",
          "--rounded-btn": "0.5rem",
          "--rounded-badge": "1rem",
          "--animation-btn": "0.2s",
        },
      },
      {
        monodark: {
          primary: "#d4d4d8", // zinc-300
          "primary-content": "#18181b", // zinc-900
          secondary: "#a1a1aa", // zinc-400
          accent: "#d6d3d1", // stone-300
          neutral: "#27272a", // zinc-800
          "base-100": "#09090b", // zinc-950
          "base-200": "#18181b", // zinc-900
          "base-300": "#27272a", // zinc-800
          "base-content": "#e4e4e7", // zinc-200
          info: "#94a3b8", // slate-400
          success: "#a3e635", // lime-400
          warning: "#fbbf24", // amber-400
          error: "#fb7185", // rose-400
          "--rounded-box": "0.75rem",
          "--rounded-btn": "0.5rem",
          "--rounded-badge": "1rem",
          "--animation-btn": "0.2s",
        },
      },
      {
        // terminal — phosphor green ink. Light is dark green on warm paper
        // (a printout), dark is green on near-black (the CRT).
        terminallight: {
          primary: "#15803d", // green-700
          "primary-content": "#fdfbf5",
          secondary: "#0f766e", // teal-700
          accent: "#4d7c0f", // lime-700
          neutral: "#1c2b1f",
          "base-100": "#faf6ea",
          "base-200": "#f2ecda",
          "base-300": "#e3dac2",
          "base-content": "#14351f",
          info: "#0f766e", // teal-700
          success: "#15803d", // green-700
          warning: "#a16207", // yellow-700
          error: "#b91c1c", // red-700
          "--rounded-box": "0.75rem",
          "--rounded-btn": "0.5rem",
          "--rounded-badge": "1rem",
          "--animation-btn": "0.2s",
        },
      },
      {
        terminaldark: {
          primary: "#4ade80", // green-400
          "primary-content": "#04120a",
          secondary: "#2dd4bf", // teal-400
          accent: "#a3e635", // lime-400
          neutral: "#14261a",
          "base-100": "#04120a",
          "base-200": "#0a1f12",
          "base-300": "#12331f",
          "base-content": "#86efac", // green-300
          info: "#5eead4", // teal-300
          success: "#4ade80", // green-400
          warning: "#fde047", // yellow-300
          error: "#fca5a5", // red-300
          "--rounded-box": "0.75rem",
          "--rounded-btn": "0.5rem",
          "--rounded-badge": "1rem",
          "--animation-btn": "0.2s",
        },
      },
      {
        // sunset — warm rose/orange primary against a violet secondary, on
        // bases tinted toward the warm end so the chrome reads as dusk.
        sunsetlight: {
          primary: "#e11d48", // rose-600
          // Pure white, not a warm off-white: rose-600 only clears 4.5:1
          // against #ffffff. The theme's warmth lives in the bases and accent.
          "primary-content": "#ffffff",
          secondary: "#7c3aed", // violet-600
          accent: "#ea580c", // orange-600
          neutral: "#3b1f2b",
          "base-100": "#fffaf6",
          "base-200": "#fdeee3",
          "base-300": "#f7dcc9",
          "base-content": "#3a1d24",
          info: "#0e7490", // cyan-700
          success: "#15803d", // green-700
          warning: "#b45309", // amber-700
          error: "#be123c", // rose-700
          "--rounded-box": "0.75rem",
          "--rounded-btn": "0.5rem",
          "--rounded-badge": "1rem",
          "--animation-btn": "0.2s",
        },
      },
      {
        sunsetdark: {
          primary: "#fb7185", // rose-400
          "primary-content": "#2a0a13",
          secondary: "#c4b5fd", // violet-300
          accent: "#fb923c", // orange-400
          neutral: "#3b2430",
          "base-100": "#1a0f16",
          "base-200": "#251621",
          "base-300": "#35202d",
          "base-content": "#fbe3e0",
          info: "#67e8f9", // cyan-300
          success: "#6ee7b7", // emerald-300
          warning: "#fcd34d", // amber-300
          error: "#fda4af", // rose-300
          "--rounded-box": "0.75rem",
          "--rounded-btn": "0.5rem",
          "--rounded-badge": "1rem",
          "--animation-btn": "0.2s",
        },
      },
    ],
  },
}
