import fs from "node:fs"
import path from "node:path"
import { type FsWatchUnsubscribe, watchFile } from "../../platform/fswatch.repo"
import {
  type CanvasSnapshot,
  canvasEqual,
  canvasPathFor,
  emptyCanvas,
  parseCanvas,
  serializeCanvas,
} from "./canvas.core"

// A per-document room. Subscribers see every external mutation (typically the
// AI writing the canvas file via its file tools) and every peer mutation
// (other browser tabs editing the same canvas). The sender of a mutation is
// excluded from its own broadcast so a freshly-edited tab doesn't echo its own
// state back over the wire mid-drag.

export type CanvasSubscriber = (snap: CanvasSnapshot, fromSelf: boolean) => void

type Room = {
  readonly filePath: string
  cache: CanvasSnapshot
  readonly subscribers: Map<symbol, CanvasSubscriber>
  unwatch: FsWatchUnsubscribe | null
  // Token of the in-flight write we just initiated. The fs-watcher will
  // re-read after our own atomic rename completes; if the disk content
  // matches what we just wrote, we suppress the broadcast.
  lastSelfWrite: string | null
}

// Keyed by absolute file path — one room per document, whether that document
// is a session canvas (~/.claude/jobs/<short>/canvas.json) or a project
// brainstorm (<project>/.pid/brainstorms/<id>.canvas.json).
const rooms = new Map<string, Room>()

const readSnapshotFromDisk = async (filePath: string): Promise<CanvasSnapshot> => {
  try {
    const raw = await fs.promises.readFile(filePath, "utf8")
    if (!raw.trim()) return emptyCanvas()
    return parseCanvas(JSON.parse(raw))
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException | undefined)?.code
    if (code === "ENOENT") return emptyCanvas()
    throw err
  }
}

const writeSnapshotAtomic = async (filePath: string, snap: CanvasSnapshot): Promise<string> => {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true })
  const body = serializeCanvas(snap)
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`
  await fs.promises.writeFile(tmp, body, "utf8")
  // tmp+rename so concurrent readers never observe a half-written file (mirrors
  // the supervisor's roster.json rewrite pattern; see platform/fswatch.repo
  // for the watcher that copes with the resulting inode swap).
  await fs.promises.rename(tmp, filePath)
  return body
}

const ensureRoom = async (filePath: string): Promise<Room> => {
  const existing = rooms.get(filePath)
  if (existing) return existing
  const cache = await readSnapshotFromDisk(filePath)
  const room: Room = {
    filePath,
    cache,
    subscribers: new Map(),
    unwatch: null,
    lastSelfWrite: null,
  }
  rooms.set(filePath, room)
  room.unwatch = watchFile(filePath, () => {
    void handleFileChange(room)
  })
  return room
}

const handleFileChange = async (room: Room): Promise<void> => {
  let next: CanvasSnapshot
  try {
    next = await readSnapshotFromDisk(room.filePath)
  } catch (err) {
    console.error("[canvas.repo] read failed", room.filePath, err)
    return
  }
  const incomingBody = serializeCanvas(next)
  if (room.lastSelfWrite !== null && room.lastSelfWrite === incomingBody) {
    // Our own write just landed — clear the marker and stay silent. Without
    // this every browser-driven edit would round-trip back to every connected
    // tab (including the originator) and stomp on in-flight drag state.
    room.lastSelfWrite = null
    return
  }
  if (canvasEqual(room.cache, next)) return
  room.cache = next
  for (const sub of room.subscribers.values()) sub(next, false)
}

export type CanvasRoom = {
  readonly snapshot: () => CanvasSnapshot
  readonly subscribe: (sub: CanvasSubscriber) => () => void
  readonly publish: (next: CanvasSnapshot, origin: symbol | null) => Promise<CanvasSnapshot>
}

// Session-canvas entry point, kept as the narrow public API the canvas routes
// use. Brainstorms (and any future document-backed canvas) go through
// getCanvasRoomAt with an explicit path.
export const getCanvasRoom = (configDir: string, short: string): Promise<CanvasRoom> =>
  getCanvasRoomAt(canvasPathFor(configDir, short))

export const getCanvasRoomAt = async (filePath: string): Promise<CanvasRoom> => {
  const room = await ensureRoom(filePath)
  return {
    snapshot: () => room.cache,
    subscribe: (sub) => {
      const key = Symbol("canvas-sub")
      room.subscribers.set(key, sub)
      return () => {
        room.subscribers.delete(key)
        // Keep the room alive even with zero subscribers: the file watcher is
        // cheap and the AI can write to canvas.json with nobody listening yet.
        // Browsers reconnecting later still see fresh state.
      }
    },
    publish: async (next, origin) => {
      const stamped: CanvasSnapshot = { ...next, updatedAt: new Date().toISOString() }
      try {
        const body = await writeSnapshotAtomic(room.filePath, stamped)
        room.lastSelfWrite = body
      } catch (err) {
        console.error("[canvas.repo] write failed", room.filePath, err)
        throw err
      }
      room.cache = stamped
      for (const [key, sub] of room.subscribers.entries()) {
        sub(stamped, origin !== null && key === origin)
      }
      return stamped
    },
  }
}

// Test-only escape hatch. Bun's per-file isolation means production state is
// fine, but our integration tests need to wipe the module-level `rooms` map
// between cases so file watchers from prior tests don't leak.
export const __resetCanvasRoomsForTests = (): void => {
  for (const room of rooms.values()) {
    if (room.unwatch) room.unwatch()
  }
  rooms.clear()
}
