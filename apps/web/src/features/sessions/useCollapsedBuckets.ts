import { useCallback, useEffect, useState } from "react"

const STORAGE_KEY = "pid:sidebar:collapsed-bucket-keys"

// Collapsed bucket keys live in localStorage like pinned project ids (see
// usePinnedProjects) — per-browser UI pref, no daemon endpoint.

export const parseCollapsedKeys = (raw: string | null): ReadonlySet<string> => {
  if (!raw) return new Set()
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((v): v is string => typeof v === "string"))
  } catch {
    return new Set()
  }
}

export const toggleKey = (keys: ReadonlySet<string>, key: string): ReadonlySet<string> => {
  const next = new Set(keys)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  return next
}

const readFromStorage = (): ReadonlySet<string> => {
  if (typeof window === "undefined") return new Set()
  try {
    return parseCollapsedKeys(window.localStorage.getItem(STORAGE_KEY))
  } catch {
    return new Set()
  }
}

const writeToStorage = (keys: ReadonlySet<string>): void => {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...keys]))
  } catch {
    // quota / privacy mode — UI still works, just won't persist
  }
}

export type UseCollapsedBuckets = {
  readonly isCollapsed: (bucketKey: string) => boolean
  readonly toggleCollapsed: (bucketKey: string) => void
}

export const useCollapsedBuckets = (): UseCollapsedBuckets => {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => readFromStorage())

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return
      setCollapsed(readFromStorage())
    }
    window.addEventListener("storage", onStorage)
    return () => window.removeEventListener("storage", onStorage)
  }, [])

  const toggleCollapsed = useCallback((bucketKey: string) => {
    setCollapsed((prev) => {
      const next = toggleKey(prev, bucketKey)
      writeToStorage(next)
      return next
    })
  }, [])

  const isCollapsed = useCallback((bucketKey: string) => collapsed.has(bucketKey), [collapsed])

  return { isCollapsed, toggleCollapsed }
}
