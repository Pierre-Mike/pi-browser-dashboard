import daisyui from "daisyui"

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "media",
  theme: {
    extend: {},
  },
  plugins: [daisyui],
  // daisyUI gives us a coherent component layer (btn / tab / menu / badge /
  // card) on top of Tailwind. We keep `base: false` so daisyUI never paints
  // the global background/foreground — the app's slate palette stays in charge
  // and the live xterm theming (terminal-light-mode e2e) is untouched. Only the
  // component + util layers are emitted, tinted by the two themes below. The
  // dark theme auto-applies under `prefers-color-scheme: dark` (no data-theme
  // toggle needed), matching Tailwind's `darkMode: "media"`.
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
    ],
  },
}
