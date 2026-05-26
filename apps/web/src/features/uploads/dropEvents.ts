// Tiny app-wide pub/sub so the dropzone can fan out "an uploaded path is now
// available" to anything that wants to consume it (e.g. SpawnModal injects
// the path into its textarea). Backed by a plain Set rather than DOM events
// so it works identically under bun:test where window is undefined.

export type DroppedPathListener = (path: string) => void

const listeners = new Set<DroppedPathListener>()

export const subscribeDroppedPaths = (fn: DroppedPathListener): (() => void) => {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export const emitDroppedPath = (path: string): void => {
  for (const fn of listeners) fn(path)
}
