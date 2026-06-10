import fs from "node:fs"

export type FsWatchUnsubscribe = () => void

const POLL_INTERVAL_MS = 500

export type StatSig = {
  readonly exists: boolean
  readonly mtimeMs: number
  readonly size: number
  readonly ino: number
}

const NONEXISTENT: StatSig = { exists: false, mtimeMs: 0, size: 0, ino: 0 }

export const statSig = (filePath: string): StatSig => {
  try {
    const s = fs.statSync(filePath)
    return { exists: true, mtimeMs: s.mtimeMs, size: s.size, ino: s.ino }
  } catch {
    return NONEXISTENT
  }
}

export const sigEqual = (a: StatSig, b: StatSig): boolean =>
  a.exists === b.exists && a.mtimeMs === b.mtimeMs && a.size === b.size && a.ino === b.ino

/**
 * Watch a file for changes. Polls every 500ms — survives atomic-rename writes
 * (the macOS `fs.watch` failure mode where rewriting `roster.json` via
 * write-to-tmp + rename orphans the watched inode). Tolerates a missing file:
 * fires on creation, on every content change, and on deletion. Returns an
 * unsubscribe function.
 */
export const watchFile = (filePath: string, onChange: () => void): FsWatchUnsubscribe => {
  let lastSig = statSig(filePath)
  const interval = setInterval(() => {
    const next = statSig(filePath)
    if (!sigEqual(lastSig, next)) {
      lastSig = next
      try {
        onChange()
      } catch (err) {
        console.error("[fswatch] onChange threw for", filePath, err)
      }
    }
  }, POLL_INTERVAL_MS)
  // Don't keep the event loop alive solely for watchers.
  if (typeof interval.unref === "function") interval.unref()

  return () => {
    clearInterval(interval)
  }
}
