import { useCallback, useEffect, useState, useSyncExternalStore } from "react"
import {
  DEFAULT_THEME,
  parseStoredTheme,
  resolveTheme,
  schemeForThemeName,
  serializeTheme,
  type ThemeChoice,
  type ThemeMode,
  type ThemeSelection,
} from "./theme.core"

// The I/O edge of the theme: localStorage, matchMedia, and the two attributes on
// <html>. Every decision lives in theme.core.ts — this file only reads facts,
// writes the answer, and notifies React.
//
// Persistence is per-browser (localStorage), like usePersistedFlag and
// usePinnedProjects. Promoting the choice to a machine-wide default belongs in
// the global-settings file, which is a daemon round-trip and a later change.

// Not exported: nothing outside this module should reach past the hook to the
// storage layer. The e2e suite seeds the literal key, and says so.
const THEME_STORAGE_KEY = "pid:ui:theme"

const PREFERS_DARK = "(prefers-color-scheme: dark)"

const read = (): ThemeChoice => {
  if (typeof window === "undefined") return DEFAULT_THEME
  try {
    return parseStoredTheme({ raw: window.localStorage.getItem(THEME_STORAGE_KEY) })
  } catch {
    return DEFAULT_THEME
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
let current: ThemeChoice = read()
const listeners = new Set<() => void>()

const snapshot = (): ThemeChoice => current

const subscribe = (onStoreChange: () => void): (() => void) => {
  listeners.add(onStoreChange)
  return () => {
    listeners.delete(onStoreChange)
  }
}

const notify = (): void => {
  for (const listener of listeners) listener()
}

const publish = (next: ThemeChoice): void => {
  current = next
  write(next)
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
  applyTheme(resolveTheme({ ...current, prefersDark: prefersDarkNow() }))
  // Another tab of the same dashboard changed the theme: adopt it without
  // writing back (that would ping-pong between tabs).
  window.addEventListener("storage", (event) => {
    if (event.key !== THEME_STORAGE_KEY) return
    current = read()
    notify()
  })
}

export const useTheme = (): ThemeSelection => {
  const choice = useSyncExternalStore(subscribe, snapshot, snapshot)
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

  const setFamily = useCallback((family: string) => publish({ ...current, family }), [])
  const setMode = useCallback((mode: ThemeMode) => publish({ ...current, mode }), [])

  return { choice, resolved, setFamily, setMode }
}
