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
    "--color-accent": "#a26907",
    "--color-neutral": "#1e293b",
    "--color-base-100": "#ffffff",
    "--color-base-200": "#f1f5f9",
    "--color-base-300": "#e2e8f0",
    "--color-base-content": "#0f172a",
    "--color-info": "#0369a1",
    "--color-success": "#0c855d",
    "--color-warning": "#a26907",
    "--color-error": "#e80d33",
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
    "--color-accent": "#c64a0a",
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
  // exist to be obviously different at a glance, and every one of them cleared
  // the ink floor from the day it landed — back when `pid` and `sunset` between
  // them still held four exemptions. There is no exemption set to be absent from
  // any more: all eighteen themes now clear 4.5:1 on every ink token.
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
  // ── prism ─────────────────────────────────────────────────────────────────
  //
  // The other three pop families are each built around one or two hues and tint
  // their base surfaces to match. `prism` is the opposite construction: six
  // maximally-saturated hues at once, on chrome with **no hue at all**.
  //
  // It comes from a reference palette of five Material-A400-ish blocks —
  // #ff3d00 / #ffea00 / #00e676 / #00b0ff / #d5006d — plus #00e5ff for the cyan
  // slot ANSI needs. The happy accident worth knowing: **that is an ANSI
  // palette.** Six saturated hues, and six slots already named for them, which
  // is why `prismdark` is the most faithful palette in this file.
  //
  // Two structural choices, both deliberate:
  //
  // 1. **The shell gradient crosses hues, and `base-300` is saturated.** The
  //    first attempt gave `prism` *neutral* chrome, on the reasoning that a
  //    family with six equal hues cannot tint its surfaces without promoting one
  //    of them. Screenshots killed it: five of the six hues live in `success` /
  //    `warning` / `error` / `info`, which only appear when a session has
  //    something to report, so an idle dashboard showed exactly one colour and
  //    `prismlight` read as `mono` with a pink accent. The colour has to sit
  //    where it is always visible, so `base-100` -> `base-200` is a **two-hue
  //    wash** (lemon-white to pale cyan; violet-black to teal-black) and
  //    `base-300` — the border colour, at 3px on every card — carries a third.
  //    `themeCatalog.test.ts` asserts both gradient stops carry a real hue and
  //    that they are *different* hues, so nobody can quietly flatten this back
  //    to neutral: that is the specific mistake it is guarding.
  // 2. **Six distinct ink values across seven tokens.** All six reference hues
  //    are reachable in the UI: magenta `primary`, blue `secondary`, green
  //    `accent`, cyan `info`, yellow `warning`, orange-red `error`. Only
  //    `success` doubles up (with `accent`, both green), the same
  //    one-alias-for-a-good-reason pattern `pidlight` uses for `warning`/`accent`.
  {
    name: "prismlight",
    "color-scheme": "light",
    // The one reference hex that clears the ink floor untouched: #d5006d is
    // 5.12:1 here, so the brand hue is literal in BOTH variants.
    "--color-primary": "#d5006d",
    "--color-primary-content": "#fffef5",
    // The rest are the same hues darkened to clear 4.5:1, chroma held near max —
    // the reference values are 1.23:1 (yellow) to 3.55:1 (orange) as ink on
    // white, so none of them could ship as-is. Their spreads stay 127-218, which
    // is what keeps them reading as the reference rather than as a muted set.
    "--color-secondary": "#017bb4",
    "--color-accent": "#018646",
    "--color-neutral": "#1c1c22",
    // The two-hue wash: lemon-white to pale cyan. Both carry a real tint (spread
    // 10 and 23) and they are dominant in different channels (r then b).
    "--color-base-100": "#fffef5",
    "--color-base-200": "#e8faff",
    // A real pink, not a gray step — at `--border: 3px` this outlines every card,
    // input and panel, which is the third hue an idle page shows.
    "--color-base-300": "#ffb3dd",
    "--color-base-content": "#131318",
    "--color-info": "#01808f",
    "--color-success": "#018646",
    // Yellow is the hue that loses most: #ffea00 is 1.23:1 on white, and 4.5:1
    // forces it to bronze. Same place every other light theme puts `warning`.
    "--color-warning": "#807601",
    "--color-error": "#db3401",
    "--radius-box": "0.25rem",
    "--radius-field": "0.25rem",
    "--radius-selector": "0.25rem",
    "--border": "3px",
    "--depth": "0",
    "--noise": "0",
  },
  {
    name: "prismdark",
    "color-scheme": "dark",
    // Five of the seven ink tokens below are the reference hexes VERBATIM: on
    // #140620 they measure 5.50 to 15.81, so the floor asked nothing of them.
    // Only the magenta needed moving — #d5006d is 3.76 here — and it moved the
    // minimum distance to clear, staying on hue (329 -> 328).
    "--color-primary": "#f5008a",
    "--color-primary-content": "#140620",
    "--color-secondary": "#00b0ff",
    "--color-accent": "#00e676",
    "--color-neutral": "#330a26",
    // The dark wash: violet-black to teal-black. Blue-dominant then
    // green-dominant — an earlier pair (#140620 / #05191a) looked like it crossed
    // but did not, because the teal's blue channel still beat its green by 1.
    "--color-base-100": "#140620",
    "--color-base-200": "#051a12",
    "--color-base-300": "#330a26",
    "--color-base-content": "#eaeaf2",
    "--color-info": "#00e5ff",
    "--color-success": "#00e676",
    "--color-warning": "#ffea00",
    "--color-error": "#ff3d00",
    "--radius-box": "0.25rem",
    "--radius-field": "0.25rem",
    "--radius-selector": "0.25rem",
    "--border": "3px",
    "--depth": "0",
    "--noise": "0",
  },
  // ── neon ──────────────────────────────────────────────────────────────────
  //
  // The brightest family in the file, and it gets there by attacking the one
  // thing every family before it treated as fixed: that `base-100` is a
  // near-white or a near-black. It is not. The only gate on the base surfaces is
  // `base-content` at 7:1, and that is a *ratio* — it says the two must be far
  // apart, never that either has to be neutral. Read the other way it is a
  // licence: pick the ink at one extreme and the surface can be a fully
  // saturated colour at the other.
  //
  // So `neonlight` is a highlighter rather than a tinted white. `base-100` is
  // electric lemon #f5ff00 (channel spread 255, luminance 0.84) and `base-200`
  // electric cyan #00f0ff (spread 255) — against near-black ink they measure
  // 18.35:1 and 14.26:1, nowhere near the 7:1 limit. For scale: `prismlight`
  // held the previous record for a coloured wash at spreads of 10 and 23. This
  // is the same construction with 25x the chroma, and it is the answer to the
  // reason `prism` needed a second pass at all — five of the seven ink tokens
  // only paint when a session has something to report, so an idle dashboard
  // shows whatever the *surfaces* are, and the surfaces are where the headroom
  // was sitting unused.
  //
  // `base-300` is the third always-visible hue — the outline on every card, panel
  // and input: #ff5ce6 light, #9c005c dark. The rule for picking it was learned
  // from a screenshot rather than from a ratio, and it is the opposite of the
  // obvious one: **a border is only as visible as its difference from the surface
  // behind it**, not as visible as its own chroma. The dark variant's first pass
  // used electric violet #5200f0 (spread 240, the most chromatic value a 7:1
  // border can hold) and it vanished against an indigo `base-100`. Deep magenta at
  // spread 156 is less saturated and far more visible.
  //
  // Which is also why the three always-painted surfaces here each dominate a
  // *different* RGB channel — lemon/cyan/pink light, indigo/teal/magenta dark. An
  // idle page therefore shows one hue per channel, with nothing running and no
  // status token painted, and `themeCatalog.test.ts` pins exactly that.
  //
  // The light inks pay the usual price and it is the usual price: on a lemon
  // `base-100` an ink token has to clear 4.5:1, which caps it at luminance 0.147
  // (0.183 on white), so each one is the lightest fully-saturated value at its
  // hue that still clears — #d1006a magenta at 4.90, #ae00e6 violet at 4.87,
  // #006ad0 azure at 4.83. Yellow and lime cannot survive as ink at any
  // lightness, exactly as in `candy` / `citrus` / `prism`; here that costs
  // nothing, because lemon is the page.
  //
  // The dark variant is where a bright family is least compromised, so it is the
  // one to look at first: ink on a near-black surface must be *light*, and light
  // saturated colour is neon. All seven ink tokens are electric and all seven are
  // a different hue — cyan, magenta, lime, azure, spring green, yellow, red —
  // which is one more distinct hue than `prism` reaches with six.
  {
    name: "neonlight",
    "color-scheme": "light",
    // Each of these is the lightest fully-saturated value at its hue that clears
    // 4.5:1 on a lemon base-100. Measured, in token order: 4.90 / 4.87 / 4.83 /
    // 4.75 / 4.62 / 4.72 / 4.86.
    "--color-primary": "#d1006a",
    // Lemon type on a magenta button (4.90:1), not the near-white every other
    // family uses. `primary-content` is a surface's worth of pixels on every
    // primary button in the app, and a white one would be the single largest
    // place this family throws colour away.
    "--color-primary-content": "#f5ff00",
    "--color-secondary": "#ae00e6",
    "--color-accent": "#006ad0",
    "--color-neutral": "#2b0044",
    // The highlighter. Not a tinted white: lemon at full chroma, and cyan at full
    // chroma to wash to. 18.35:1 and 14.26:1 against the ink below.
    "--color-base-100": "#f5ff00",
    "--color-base-200": "#00f0ff",
    // Hot electric pink, 7.58:1 — the widest chroma a 7:1 border can hold with
    // ink this dark, found by search rather than by eye (#ff2fd0 is prettier and
    // fails at 6.37).
    "--color-base-300": "#ff5ce6",
    // Violet-black rather than neutral black: even the ink carries a hue here,
    // and dropping it this low is also what buys base-300 its chroma.
    "--color-base-content": "#12001f",
    "--color-info": "#00778f",
    "--color-success": "#00803a",
    // Yellow as ink is the hue that cannot survive the floor — the same landing
    // spot as every other light theme in this file. The family's actual yellow is
    // the page.
    "--color-warning": "#8a6800",
    "--color-error": "#d90000",
    // A neon tube is bent glass: fully-pill controls and chips inside a rounded
    // panel, behind the thickest rule in the set, lifted. The one family whose
    // `radius-field` is *larger* than its `radius-box`.
    "--radius-box": "1.25rem",
    "--radius-field": "2rem",
    "--radius-selector": "2rem",
    "--border": "4px",
    "--depth": "1",
    "--noise": "0",
  },
  {
    name: "neondark",
    "color-scheme": "dark",
    // Seven ink tokens, seven distinct electric hues, six of them a pure channel
    // triple (a 0 and a 255). Measured on base-100: 11.84 / 4.93 / 14.06 / 6.39 /
    // 12.53 / 15.29 / 4.62.
    "--color-primary": "#00f0ff",
    "--color-primary-content": "#16006e",
    "--color-secondary": "#ff00d4",
    "--color-accent": "#c6ff00",
    "--color-neutral": "#2a0d80",
    // Electric indigo, and this exact luminance is a measured boundary rather than
    // a taste. `base-100` is ~75% of the painted pixels on a real dashboard — the
    // sidebar and every card are opaque `bg-base-100` *over* the shell gradient,
    // which is why it dwarfs every other token and is the only one worth spending
    // the whole budget on. Raising it brightens the page and raises the ink floor
    // in the same move, and the first token to fall off that floor is `error`: at
    // luminance 0.013 a genuine red still clears (#ff3348, 4.62) and much past it
    // red turns coral. A theme that cannot say "failed" in red has traded away the
    // wrong thing, so the climb stops here — 3.4x `prismdark`'s base-100 luminance
    // and 4.2x its chroma.
    "--color-base-100": "#16006e",
    // Deep emerald-teal, luminance 0.081: 10x `prismdark`'s base-200, which sat at
    // 0.008 and so was indistinguishable from its own base-100. This is the
    // second-largest painted area — the shell gradient, every gutter between
    // cards, the whole lower page.
    "--color-base-200": "#005c4a",
    // Deep magenta, chosen for its *contrast against base-100* rather than for its
    // own chroma, which is the correction that made this family work. The first
    // pass used electric violet #5200f0 — spread 240, far more chromatic than this
    // — and on an indigo page it was invisible: a border is only as visible as its
    // difference from the surface behind it, and screenshots said so immediately.
    "--color-base-300": "#9c005c",
    "--color-base-content": "#f7f5ff",
    "--color-info": "#00a8ff",
    "--color-success": "#00ff9c",
    "--color-warning": "#f7ff00",
    // The one ink token that is not a pure triple: pure #ff0000 measures 3.70 on
    // this base-100 and misses. #ff3348 is the minimum move that clears, and it is
    // still unambiguously red — r 255 against g 51 and b 72.
    "--color-error": "#ff3348",
    "--radius-box": "1.25rem",
    "--radius-field": "2rem",
    "--radius-selector": "2rem",
    "--border": "4px",
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
