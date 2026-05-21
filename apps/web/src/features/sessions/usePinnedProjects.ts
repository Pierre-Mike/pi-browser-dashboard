import { useCallback, useEffect, useState } from "react"

const STORAGE_KEY = "pid:sidebar:pinned-project-ids"

// Pinned project IDs live in localStorage so the bias survives reloads but
// stays per-browser. The daemon owns no UI prefs (see AGENTS.md persistence
// row); keeping this here avoids a round-trip and a new endpoint.
//
// Listen for storage events too — when the user toggles a pin in tab A, tab B
// reorders on the next render instead of staying stale until reload.
const readFromStorage = (): ReadonlySet<string> => {
  if (typeof window === "undefined") return new Set()
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return new Set()
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((v): v is string => typeof v === "string"))
  } catch {
    return new Set()
  }
}

const writeToStorage = (ids: ReadonlySet<string>): void => {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]))
  } catch {
    // quota / privacy mode — UI still works, just won't persist
  }
}

export type UsePinnedProjects = {
  readonly pinnedIds: ReadonlySet<string>
  readonly isPinned: (projectId: string) => boolean
  readonly togglePin: (projectId: string) => void
}

export const usePinnedProjects = (): UsePinnedProjects => {
  const [pinnedIds, setPinnedIds] = useState<ReadonlySet<string>>(() => readFromStorage())

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return
      setPinnedIds(readFromStorage())
    }
    window.addEventListener("storage", onStorage)
    return () => window.removeEventListener("storage", onStorage)
  }, [])

  const togglePin = useCallback((projectId: string) => {
    setPinnedIds((prev) => {
      const next = new Set(prev)
      if (next.has(projectId)) next.delete(projectId)
      else next.add(projectId)
      writeToStorage(next)
      return next
    })
  }, [])

  const isPinned = useCallback((projectId: string) => pinnedIds.has(projectId), [pinnedIds])

  return { pinnedIds, isPinned, togglePin }
}
