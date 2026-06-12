import { useCallback, useEffect, useMemo, useState } from "react"

const STORAGE_KEY = "pid:sidebar:pinned-project-ids"

// Pinned project IDs live in localStorage so the bias survives reloads but
// stays per-browser. The daemon owns no UI prefs (see AGENTS.md persistence
// row); keeping this here avoids a round-trip and a new endpoint.
//
// The list is ORDERED: its position is the user's manual ranking (drag to
// reorder in the sidebar), so we store an array — not a set — and the first
// entry is the topmost pin.
//
// Listen for storage events too — when the user toggles or reorders a pin in
// tab A, tab B reflects it on the next render instead of staying stale until
// reload.

export const parsePinnedIds = (raw: string | null): readonly string[] => {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const seen = new Set<string>()
    const out: string[] = []
    for (const v of parsed) {
      if (typeof v !== "string" || seen.has(v)) continue
      seen.add(v)
      out.push(v)
    }
    return out
  } catch {
    return []
  }
}

export const togglePinned = (order: readonly string[], id: string): readonly string[] => {
  if (order.includes(id)) return order.filter((x) => x !== id)
  return [...order, id]
}

// Move `draggedId` so it sits immediately before `targetId`. No-op when either
// id is missing or they're the same — the caller need not pre-validate.
export const reorderPinned = (
  order: readonly string[],
  { draggedId, targetId }: { draggedId: string; targetId: string },
): readonly string[] => {
  if (draggedId === targetId) return order
  if (!order.includes(draggedId) || !order.includes(targetId)) return order
  const without = order.filter((x) => x !== draggedId)
  const at = without.indexOf(targetId)
  return [...without.slice(0, at), draggedId, ...without.slice(at)]
}

const readFromStorage = (): readonly string[] => {
  if (typeof window === "undefined") return []
  try {
    return parsePinnedIds(window.localStorage.getItem(STORAGE_KEY))
  } catch {
    return []
  }
}

const writeToStorage = (order: readonly string[]): void => {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(order))
  } catch {
    // quota / privacy mode — UI still works, just won't persist
  }
}

export type UsePinnedProjects = {
  // Iteration order = pin order; sidebar sorting reads it as the manual rank.
  readonly pinnedIds: ReadonlySet<string>
  readonly isPinned: (projectId: string) => boolean
  readonly togglePin: (projectId: string) => void
  readonly reorderPin: (draggedId: string, targetId: string) => void
}

export const usePinnedProjects = (): UsePinnedProjects => {
  const [pinnedOrder, setPinnedOrder] = useState<readonly string[]>(() => readFromStorage())

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return
      setPinnedOrder(readFromStorage())
    }
    window.addEventListener("storage", onStorage)
    return () => window.removeEventListener("storage", onStorage)
  }, [])

  const togglePin = useCallback((projectId: string) => {
    setPinnedOrder((prev) => {
      const next = togglePinned(prev, projectId)
      writeToStorage(next)
      return next
    })
  }, [])

  const reorderPin = useCallback((draggedId: string, targetId: string) => {
    setPinnedOrder((prev) => {
      const next = reorderPinned(prev, { draggedId, targetId })
      if (next === prev) return prev
      writeToStorage(next)
      return next
    })
  }, [])

  // Set preserves insertion order, so downstream consumers can read pin order
  // by iterating it while keeping O(1) membership checks.
  const pinnedIds = useMemo(() => new Set(pinnedOrder), [pinnedOrder])
  const isPinned = useCallback((projectId: string) => pinnedIds.has(projectId), [pinnedIds])

  return { pinnedIds, isPinned, togglePin, reorderPin }
}
