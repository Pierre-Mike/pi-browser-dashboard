import { useCallback, useEffect, useState } from "react"

// A single boolean UI preference (e.g. "is this left rail collapsed?") persisted
// per-browser in localStorage — same philosophy as useCollapsedBuckets /
// usePinnedProjects: no daemon endpoint, just a view pref. The pure parse /
// serialize split keeps the storage encoding unit-testable without a renderer.

// Stored as the "1" sentinel so an absent key (null) reads as false.
export const parseFlag = (raw: string | null): boolean => raw === "1"
export const serializeFlag = (value: boolean): string => (value ? "1" : "0")

const read = (key: string): boolean => {
  if (typeof window === "undefined") return false
  try {
    return parseFlag(window.localStorage.getItem(key))
  } catch {
    return false
  }
}

const write = (key: string, value: boolean): void => {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(key, serializeFlag(value))
  } catch {
    // quota / privacy mode — UI still works, just won't persist
  }
}

export type UsePersistedFlag = {
  readonly value: boolean
  readonly toggle: () => void
}

export const usePersistedFlag = (key: string): UsePersistedFlag => {
  const [value, setValue] = useState<boolean>(() => read(key))

  // Mirror the value across tabs/windows sharing this browser.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === key) setValue(read(key))
    }
    window.addEventListener("storage", onStorage)
    return () => window.removeEventListener("storage", onStorage)
  }, [key])

  const toggle = useCallback(() => {
    setValue((prev) => {
      const next = !prev
      write(key, next)
      return next
    })
  }, [key])

  return { value, toggle }
}
