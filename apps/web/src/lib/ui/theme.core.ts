// The theme catalog and every *decision* about which daisyUI theme is active.
//
// Pure by shape (`*.core.ts`): no localStorage, no matchMedia, no document.
// The I/O edge is `useTheme.ts`, which feeds this module the facts it needs (the
// stored choice, the machine-wide default, whether the OS prefers dark) and
// writes the answer onto <html>. Keeping the catalog here is what makes "does
// every family have both variants?" and "does garbage in localStorage wedge the
// UI?" unit-testable.
//
// A *family* is a pair of daisyUI themes — one light, one dark — declared in
// `apps/web/tailwind.config.js`. A *mode* says which of the pair to use, or to
// follow the OS. Family × mode is the whole user-facing choice.
//
// The choice has two *sources* — this browser's pick and the machine-wide
// default in the global-settings file — and `resolveThemeChoice` is the whole of
// the precedence between them. That it lives here and not in the hook is the
// point: precedence is a rule, and a rule inlined into an effect is a rule no
// test can name.
import type { UiSettings } from "@pid/shared"

export type ThemeMode = "system" | "light" | "dark"

export const THEME_MODES: readonly ThemeMode[] = ["system", "light", "dark"]

export const THEME_MODE_LABELS: Readonly<Record<ThemeMode, string>> = {
  system: "Follow the OS",
  light: "Light",
  dark: "Dark",
}

export type ThemeFamily = {
  readonly id: string
  readonly label: string
  // daisyUI theme names, exactly as declared in tailwind.config.js. The dark
  // one must end in "dark": tailwind's darkMode selector is
  // [data-theme$="dark"], so the suffix is load-bearing, not cosmetic.
  readonly light: string
  readonly dark: string
}

// Named so `familyById` has a total fallback that survives
// noUncheckedIndexedAccess without an assertion, and so DEFAULT_THEME derives
// its id instead of repeating the string.
const DEFAULT_FAMILY: ThemeFamily = {
  id: "pid",
  label: "Pid — sky / slate",
  light: "pidlight",
  dark: "piddark",
}

export const THEME_FAMILIES: readonly ThemeFamily[] = [
  DEFAULT_FAMILY,
  { id: "mono", label: "Mono — grayscale", light: "monolight", dark: "monodark" },
  {
    id: "terminal",
    label: "Terminal — phosphor green",
    light: "terminallight",
    dark: "terminaldark",
  },
  { id: "sunset", label: "Sunset — rose / violet", light: "sunsetlight", dark: "sunsetdark" },
  // The three saturated families. Appended, never inserted: `pid` has to stay at
  // index 0 (it carries daisyUI's `default` / `prefersdark` pair, the no-JS
  // fallback before React boots) and `nextThemeFamily` cycles in this order, so
  // the restrained families keep the low numbers a habit-driven user reaches for.
  { id: "candy", label: "Candy — bubblegum pink / cyan", light: "candylight", dark: "candydark" },
  {
    id: "arcade",
    label: "Arcade — electric violet / magenta",
    light: "arcadelight",
    dark: "arcadedark",
  },
  { id: "citrus", label: "Citrus — orange / lime", light: "citruslight", dark: "citrusdark" },
]

export type ThemeChoice = {
  readonly family: string
  readonly mode: ThemeMode
}

export const DEFAULT_THEME: ThemeChoice = { family: DEFAULT_FAMILY.id, mode: "system" }

// What one *source* of the choice offers. Either half may be absent — missing
// from that source, or naming something this build does not ship — and the two
// halves degrade independently, so a stored "vaporwave:dark" still contributes
// its mode instead of discarding both.
export type ThemeOffer = {
  readonly family?: string
  readonly mode?: ThemeMode
}

// What `useTheme()` hands the UI. Declared here so a presentational component
// can take it as a prop and render without touching the I/O edge.
export type ThemeSelection = {
  readonly choice: ThemeChoice
  readonly resolved: string
  // The machine-wide default this choice is layered over — the Appearance
  // section names it, so the hint can tell the truth about what a *different*
  // browser would show.
  readonly machine: ThemeOffer
  readonly setFamily: (id: string) => void
  readonly setMode: (mode: ThemeMode) => void
}

const isThemeMode = (raw: string): raw is ThemeMode =>
  (THEME_MODES as readonly string[]).includes(raw)

// Failure as a value: an unrecognised id is `undefined`, never an exception.
export const findFamily = (id: string): ThemeFamily | undefined =>
  THEME_FAMILIES.find((family) => family.id === id)

// …and the total version the UI uses, because a theme id nobody recognises must
// still paint a page rather than leave the shell unstyled.
const familyById = (id: string): ThemeFamily => findFamily(id) ?? DEFAULT_FAMILY

export const resolveTheme = ({
  family,
  mode,
  prefersDark,
}: {
  readonly family: string
  readonly mode: ThemeMode
  readonly prefersDark: boolean
}): string => {
  const chosen = familyById(family)
  return mode === "dark" || (mode === "system" && prefersDark) ? chosen.dark : chosen.light
}

// Encoding: "<family>:<mode>" — a sentinel pair in the same spirit as
// usePersistedFlag's "1". Two independent fields degrade independently, so a
// half-recognised value (a family we shipped, a mode we renamed) keeps the half
// that still means something instead of discarding both.
export const serializeTheme = ({ choice }: { readonly choice: ThemeChoice }): string =>
  `${choice.family}:${choice.mode}`

const offeredFamily = (raw: string | undefined): string | undefined =>
  raw !== undefined && findFamily(raw) !== undefined ? raw : undefined

const offeredMode = (raw: string | undefined): ThemeMode | undefined =>
  raw !== undefined && isThemeMode(raw) ? raw : undefined

// What this browser's own pick offers, from the localStorage value.
export const themeOfferFromStored = ({ raw }: { readonly raw: string | null }): ThemeOffer => {
  const [family, mode] = (raw ?? "").split(":")
  return { family: offeredFamily(family), mode: offeredMode(mode) }
}

// What the machine-wide default offers, from the global-settings `ui` section.
// An empty half means "unset" and an unrecognised one means "this build doesn't
// ship that" — both offer nothing, which is the same thing to the precedence
// below, so neither can wedge the UI.
export const themeOfferFromSettings = ({
  ui,
}: {
  readonly ui: UiSettings | undefined
}): ThemeOffer => ({
  family: offeredFamily(ui?.themeFamily),
  mode: offeredMode(ui?.themeMode),
})

/**
 * The precedence: this browser's explicit pick, then the machine-wide default
 * from the settings file, then `pid` in `system` mode.
 *
 * Resolved per *half*, not per source. A browser whose stored value names a
 * family this build renamed still inherits the machine's family rather than
 * snapping all the way back to `pid` — the same independent-degradation rule
 * `serializeTheme`'s two-field encoding exists for.
 *
 * The browser half is an **override**, not a cache: `useTheme` writes
 * localStorage only when someone picks, so adopting the machine default never
 * writes anything, and a machine default changed from another device does not
 * overrule a browser that has already chosen.
 */
export const resolveThemeChoice = ({
  browser,
  machine,
}: {
  readonly browser: ThemeOffer
  readonly machine: ThemeOffer
}): ThemeChoice => ({
  family: browser.family ?? machine.family ?? DEFAULT_THEME.family,
  mode: browser.mode ?? machine.mode ?? DEFAULT_THEME.mode,
})

// How the Appearance hint names the machine-wide default. A half that offers
// nothing reads as "any" rather than as a value, because that is exactly what it
// contributes: the next source decides.
export const describeMachineTheme = ({ machine }: { readonly machine: ThemeOffer }): string => {
  if (machine.family === undefined && machine.mode === undefined) return "not set"
  const family =
    machine.family === undefined
      ? "any family"
      : (findFamily(machine.family)?.label ?? "any family")
  const mode = machine.mode === undefined ? "any mode" : THEME_MODE_LABELS[machine.mode]
  return `${family} · ${mode}`
}

// True when the stored machine default already says exactly what this browser
// chose — so the "set as machine default" control can disable itself instead of
// posting a write that changes nothing.
export const machineMatchesChoice = ({
  machine,
  choice,
}: {
  readonly machine: ThemeOffer
  readonly choice: ThemeChoice
}): boolean => machine.family === choice.family && machine.mode === choice.mode

// ── palette commands ────────────────────────────────────────────────────────
//
// The theme is reachable from the command palette as well as from the Appearance
// section, so it can be changed without leaving the page you are on. The palette
// owns *registration* (see features/palette/palette.ts); the catalog and the
// meaning of each command stay here, where they are testable without a DOM.

const MODE_ACTION_PREFIX = "theme:mode:"

/** Cycles the family, wrapping. An unrecognised current id starts the cycle over. */
export const nextThemeFamily = ({ family }: { readonly family: string }): string => {
  const at = THEME_FAMILIES.findIndex((candidate) => candidate.id === family)
  return THEME_FAMILIES[(at + 1) % THEME_FAMILIES.length]?.id ?? DEFAULT_THEME.family
}

export type ThemePaletteAction = {
  readonly id: string
  readonly label: string
}

// Every label starts "Theme" so one query finds the whole group. Derived from
// THEME_MODES rather than listed, so a new mode cannot ship without a command.
export const THEME_PALETTE_ACTIONS: readonly ThemePaletteAction[] = [
  { id: "theme:family:next", label: "Theme: next family" },
  ...THEME_MODES.map((mode) => ({
    id: `${MODE_ACTION_PREFIX}${mode}`,
    label: `Theme: ${THEME_MODE_LABELS[mode]}`,
  })),
]

// What one of those commands decides, as a value the caller applies. Failure is a
// value too: an id from an older build returns null rather than throwing inside a
// keyboard handler.
export type ThemeCommand = { readonly family: string } | { readonly mode: ThemeMode }

export const themeCommandFor = ({
  id,
  current,
}: {
  readonly id: string
  readonly current: ThemeChoice
}): ThemeCommand | null => {
  if (id === "theme:family:next") return { family: nextThemeFamily({ family: current.family }) }
  if (!id.startsWith(MODE_ACTION_PREFIX)) return null
  const mode = id.slice(MODE_ACTION_PREFIX.length)
  return isThemeMode(mode) ? { mode } : null
}

// The resolved theme name is the single source of truth for light vs dark —
// the same suffix tailwind's `dark:` variant keys on. Deriving the xterm scheme
// from it (rather than from matchMedia) is what makes "terminaldark while the
// OS is light" give a dark terminal.
export const schemeForThemeName = ({ theme }: { readonly theme: string }): "light" | "dark" =>
  theme.endsWith("dark") ? "dark" : "light"
