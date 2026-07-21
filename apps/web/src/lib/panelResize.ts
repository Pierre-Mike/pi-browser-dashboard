import { useCallback, useEffect, useRef, useState } from "react"

// Pure geometry + storage encoding for a drag-resizable side panel, plus the
// hook that persists the width per-browser. Mirrors collapse.ts: a pure
// parse/serialize/clamp split keeps the width math unit-testable without a
// renderer, and the hook is the thin localStorage-backed shell around it.

export const PANEL_MIN_WIDTH = 280
export const PANEL_MAX_WIDTH = 720
// Matches the panel's previous fixed w-[24rem] (384px) so nothing shifts until
// the user drags.
export const PANEL_DEFAULT_WIDTH = 384

/** Snap a raw width into [PANEL_MIN_WIDTH, PANEL_MAX_WIDTH] and to a whole pixel. */
export const clampPanelWidth = (px: number): number =>
  Math.min(PANEL_MAX_WIDTH, Math.max(PANEL_MIN_WIDTH, Math.round(px)))

/**
 * New width from a drag of a LEFT-edge handle on a right-docked panel: moving
 * the pointer left of where the drag began (smaller x) widens the panel.
 */
export const widthFromDrag = (d: {
  startWidth: number
  startX: number
  currentX: number
}): number => clampPanelWidth(d.startWidth + (d.startX - d.currentX))

/** Decode a stored width, clamped; null when absent or non-numeric. */
export const parsePanelWidth = (raw: string | null): number | null => {
  if (raw === null || raw.trim() === "") return null
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) ? clampPanelWidth(n) : null
}

/** Encode a width for storage, clamped so a bad value never persists. */
export const serializePanelWidth = (px: number): string => String(clampPanelWidth(px))

const read = (key: string): number | null => {
  if (typeof window === "undefined") return null
  try {
    return parsePanelWidth(window.localStorage.getItem(key))
  } catch {
    return null
  }
}

const write = (key: string, px: number): void => {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(key, serializePanelWidth(px))
  } catch {
    // quota / privacy mode — resizing still works, just won't persist
  }
}

export type UsePersistedWidth = {
  readonly width: number
  readonly setWidth: (px: number) => void
}

/**
 * A single numeric width preference (e.g. "how wide is this side panel?")
 * persisted per-browser in localStorage — same philosophy as usePersistedFlag.
 */
export const usePersistedWidth = (
  key: string,
  fallback = PANEL_DEFAULT_WIDTH,
): UsePersistedWidth => {
  const [width, setWidthState] = useState<number>(() => read(key) ?? fallback)

  // Mirror the value across tabs/windows sharing this browser.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === key) setWidthState(read(key) ?? fallback)
    }
    window.addEventListener("storage", onStorage)
    return () => window.removeEventListener("storage", onStorage)
  }, [key, fallback])

  const setWidth = useCallback(
    (px: number) => {
      const clamped = clampPanelWidth(px)
      write(key, clamped)
      setWidthState(clamped)
    },
    [key],
  )

  return { width, setWidth }
}

export type UsePanelDrag = {
  // Structural (not React.PointerEvent) so the hook stays framework-lean; a
  // React onPointerDown handler satisfies it.
  readonly onResizeStart: (e: { clientX: number; preventDefault: () => void }) => void
  readonly dragging: boolean
}

/**
 * Imperative shell for a drag-to-resize handle: records the pointer/width at
 * pointer-down, then tracks window pointer moves and feeds each through the pure
 * widthFromDrag. While dragging it suppresses text selection and forces the
 * col-resize cursor page-wide so the drag stays smooth.
 */
export const usePanelDrag = (width: number, setWidth: (px: number) => void): UsePanelDrag => {
  const [dragging, setDragging] = useState(false)
  const start = useRef<{ x: number; width: number } | null>(null)

  const onResizeStart = useCallback(
    (e: { clientX: number; preventDefault: () => void }) => {
      e.preventDefault()
      start.current = { x: e.clientX, width }
      setDragging(true)
    },
    [width],
  )

  useEffect(() => {
    if (!dragging) return
    const onMove = (e: PointerEvent) => {
      const s = start.current
      if (s) setWidth(widthFromDrag({ startWidth: s.width, startX: s.x, currentX: e.clientX }))
    }
    const onUp = () => setDragging(false)
    const prevCursor = document.body.style.cursor
    const prevSelect = document.body.style.userSelect
    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
    return () => {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
      document.body.style.cursor = prevCursor
      document.body.style.userSelect = prevSelect
    }
  }, [dragging, setWidth])

  return { onResizeStart, dragging }
}
