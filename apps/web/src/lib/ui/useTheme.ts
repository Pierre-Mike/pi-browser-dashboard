import type { UiSettings } from "@pid/shared"
import { useCallback, useEffect, useState, useSyncExternalStore } from "react"
import {
  resolveTheme,
  resolveThemeChoice,
  schemeForThemeName,
  serializeTheme,
  type ThemeChoice,
  type ThemeMode,
  type ThemeOffer,
  type ThemeSelection,
  themeOfferFromSettings,
  themeOfferFromStored,
} from "./theme.core"

// The I/O edge of the theme: localStorage, matchMedia, and the two attributes on
// <html>. Every decision lives in theme.core.ts — this file only reads facts,
// writes the answer, and notifies React.
//
// Two sources feed the choice, and they arrive at different times, which is the
// whole reason this file is shaped the way it is:
//
//   - **This browser's pick** — `localStorage["pid:ui:theme"]`, synchronous, so
//     it is read and painted at *import* time, before React mounts.
//   - **The machine-wide default** — the global-settings `ui` section, which
//     costs a daemon round-trip and lands later, via `applyMachineTheme` (see
//     features/global-settings/useMachineTheme.ts).
//
// Seeding from the slow source would mean painting `pid` first and the real theme
// a round-trip later: a visible flash on every load for everyone who picked
// something. Seeding from the fast one and reconciling costs no repaint at all
// for those people, because `resolveThemeChoice` lets their pick override the
// machine default — the arriving value changes nothing they can see. A browser
// that has *never* picked has nothing to flash away from: it shows the fallback
// until the default arrives, then adopts it once.
//
// The browser value stays an **override**, not a cache: `applyMachineTheme` never
// writes localStorage, so a default changed from another device cannot overrule a
// browser that has already chosen.

// Not exported: nothing outside this module should reach past the hook to the
// storage layer. The e2e suite seeds the literal key, and says so.
const THEME_STORAGE_KEY = "pid:ui:theme"

const PREFERS_DARK = "(prefers-color-scheme: dark)"

const readStored = (): ThemeOffer => {
  if (typeof window === "undefined") return {}
  try {
    return themeOfferFromStored({ raw: window.localStorage.getItem(THEME_STORAGE_KEY) })
  } catch {
    return {}
  }
}

const write = (choice: ThemeChoice): void => {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, serializeTheme({ choice }))
  } catch {
    // quota / privacy mode — the theme still applies for this page load
  }
}

// One store per tab, not one useState per caller. The shell paints the page and
// the settings dropdown edits the choice; two independent useState hooks would
// never see each other's writes — the exact trap usePersistedFlag documents for
// the sidebar rail, which is why __root.tsx owns that one instance.
//
// `state` is rebuilt (never mutated) on every change, so it doubles as the
// useSyncExternalStore snapshot: a stable reference between notifications.
type ThemeState = {
  readonly choice: ThemeChoice
  readonly machine: ThemeOffer
}

let browser: ThemeOffer = readStored()
let machine: ThemeOffer = {}
let state: ThemeState = { choice: resolveThemeChoice({ browser, machine }), machine }

const listeners = new Set<() => void>()

const snapshot = (): ThemeState => state

/**
 * The store's current value. Exported for the co-located test, which drives the
 * two writers in sequence — the precedence between them is the behaviour worth
 * pinning, and it is unreachable through the hook without a DOM.
 */
export const themeStoreSnapshot = snapshot

const subscribe = (onStoreChange: () => void): (() => void) => {
  listeners.add(onStoreChange)
  return () => {
    listeners.delete(onStoreChange)
  }
}

const notify = (): void => {
  state = { choice: resolveThemeChoice({ browser, machine }), machine }
  for (const listener of listeners) listener()
}

/**
 * Adopt this browser's own pick. The only path that writes localStorage — which
 * is what makes the stored value an explicit override rather than a cache of
 * whatever was last displayed.
 */
export const publishThemeChoice = (choice: ThemeChoice): void => {
  browser = choice
  write(choice)
  notify()
}

/**
 * Adopt the machine-wide default from the global-settings `ui` section. Writes
 * nothing: a browser that has already picked keeps its pick, and one that has not
 * simply starts resolving through this instead of through the fallback.
 */
export const applyMachineTheme = ({ ui }: { readonly ui: UiSettings | undefined }): void => {
  const next = themeOfferFromSettings({ ui })
  if (next.family === machine.family && next.mode === machine.mode) return
  machine = next
  notify()
}

const applyTheme = (theme: string): void => {
  if (typeof document === "undefined") return
  const root = document.documentElement
  root.dataset.theme = theme
  // Tells the UA which way to paint form controls, scrollbars and the canvas
  // behind the app — the part `data-theme` alone cannot reach.
  root.style.colorScheme = schemeForThemeName({ theme })
}

const prefersDarkNow = (): boolean =>
  typeof window !== "undefined" && window.matchMedia(PREFERS_DARK).matches

// Paint at import time, before React mounts. An effect would run after the first
// paint, which is a visible flash of the default theme on every load for anyone
// who picked something else.
if (typeof window !== "undefined") {
  applyTheme(resolveTheme({ ...state.choice, prefersDark: prefersDarkNow() }))
  // Another tab of the same dashboard changed the theme: adopt it without
  // writing back (that would ping-pong between tabs).
  window.addEventListener("storage", (event) => {
    if (event.key !== THEME_STORAGE_KEY) return
    browser = readStored()
    notify()
  })
}

export const useTheme = (): ThemeSelection => {
  const { choice, machine: machineDefault } = useSyncExternalStore(subscribe, snapshot, snapshot)
  const [prefersDark, setPrefersDark] = useState<boolean>(prefersDarkNow)

  useEffect(() => {
    const mq = window.matchMedia(PREFERS_DARK)
    const onChange = (event: MediaQueryListEvent) => setPrefersDark(event.matches)
    mq.addEventListener("change", onChange)
    // The preference can have flipped between module load and mount.
    setPrefersDark(mq.matches)
    return () => mq.removeEventListener("change", onChange)
  }, [])

  const resolved = resolveTheme({ ...choice, prefersDark })

  useEffect(() => {
    applyTheme(resolved)
  }, [resolved])

  const setFamily = useCallback(
    (family: string) => publishThemeChoice({ ...state.choice, family }),
    [],
  )
  const setMode = useCallback(
    (mode: ThemeMode) => publishThemeChoice({ ...state.choice, mode }),
    [],
  )

  return { choice, resolved, machine: machineDefault, setFamily, setMode }
}
