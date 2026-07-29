// The theme catalog and every *decision* about which daisyUI theme is active.
//
// Pure by shape (`*.core.ts`): no localStorage, no matchMedia, no document.
// The I/O edge is `useTheme.ts`, which feeds this module the two facts it needs
// (the stored choice, whether the OS prefers dark) and writes the answer onto
// <html>. Keeping the catalog here is what makes "does every family have both
// variants?" and "does garbage in localStorage wedge the UI?" unit-testable.
//
// A *family* is a pair of daisyUI themes — one light, one dark — declared in
// `apps/web/tailwind.config.js`. A *mode* says which of the pair to use, or to
// follow the OS. Family × mode is the whole user-facing choice.

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
]

export type ThemeChoice = {
  readonly family: string
  readonly mode: ThemeMode
}

export const DEFAULT_THEME: ThemeChoice = { family: DEFAULT_FAMILY.id, mode: "system" }

// What `useTheme()` hands the UI. Declared here so a presentational component
// can take it as a prop and render without touching the I/O edge.
export type ThemeSelection = {
  readonly choice: ThemeChoice
  readonly resolved: string
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

export const parseStoredTheme = ({ raw }: { readonly raw: string | null }): ThemeChoice => {
  const [family = "", mode = ""] = (raw ?? "").split(":")
  return {
    family: findFamily(family) ? family : DEFAULT_THEME.family,
    mode: isThemeMode(mode) ? mode : DEFAULT_THEME.mode,
  }
}

// The resolved theme name is the single source of truth for light vs dark —
// the same suffix tailwind's `dark:` variant keys on. Deriving the xterm scheme
// from it (rather than from matchMedia) is what makes "terminaldark while the
// OS is light" give a dark terminal.
export const schemeForThemeName = ({ theme }: { readonly theme: string }): "light" | "dark" =>
  theme.endsWith("dark") ? "dark" : "light"
