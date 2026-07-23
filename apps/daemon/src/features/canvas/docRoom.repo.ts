import fs from "node:fs"
import path from "node:path"
import { type FsWatchUnsubscribe, watchFile } from "../../platform/fswatch.repo"

// Codec-generic per-document rooms. A room fans out every external mutation
// (typically the AI writing the file via its file tools) and every peer
// mutation (other browser tabs editing the same document) to its subscribers;
// the sender of a mutation is excluded from its own broadcast so a
// freshly-edited tab doesn't echo its own state back over the wire mid-drag.
// The React-Flow canvas and the Excalidraw board instantiate this factory
// with their own codecs (see canvas.repo.ts / excalidraw.repo.ts).

export type DocCodec<S> = {
  readonly parse: (raw: unknown) => S
  readonly serialize: (doc: S) => string
  readonly equal: (a: S, b: S) => boolean
  readonly empty: () => S
  // Applied to every published document before it hits disk — the canvas
  // codec stamps updatedAt; the excalidraw codec is identity so the file
  // stays byte-compatible with Excalidraw's native format.
  readonly stamp: (doc: S) => S
}

export type DocSubscriber<S> = (doc: S, fromSelf: boolean) => void

export type DocRoom<S> = {
  readonly snapshot: () => S
  readonly subscribe: (sub: DocSubscriber<S>) => () => void
  readonly publish: (next: S, origin: symbol | null) => Promise<S>
}

export type DocRooms<S> = {
  readonly getRoomAt: (filePath: string) => Promise<DocRoom<S>>
  // Test-only escape hatch. Bun's per-file isolation means production state is
  // fine, but integration tests need to wipe the room map between cases so
  // file watchers from prior tests don't leak.
  readonly resetForTests: () => void
}

type Room<S> = {
  readonly filePath: string
  cache: S
  readonly subscribers: Map<symbol, DocSubscriber<S>>
  unwatch: FsWatchUnsubscribe | null
  // Body of the in-flight write we just initiated. The fs-watcher will
  // re-read after our own atomic rename completes; if the disk content
  // matches what we just wrote, we suppress the broadcast.
  lastSelfWrite: string | null
}

export const makeDocRooms = <S>(codec: DocCodec<S>): DocRooms<S> => {
  // Keyed by absolute file path — one room per document.
  const rooms = new Map<string, Room<S>>()

  const readFromDisk = async (filePath: string): Promise<S> => {
    try {
      const raw = await fs.promises.readFile(filePath, "utf8")
      if (!raw.trim()) return codec.empty()
      return codec.parse(JSON.parse(raw))
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException | undefined)?.code
      if (code === "ENOENT") return codec.empty()
      throw err
    }
  }

  const writeAtomic = async (filePath: string, doc: S): Promise<string> => {
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true })
    const body = codec.serialize(doc)
    const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`
    await fs.promises.writeFile(tmp, body, "utf8")
    // tmp+rename so concurrent readers never observe a half-written file
    // (mirrors the supervisor's roster.json rewrite pattern; see
    // platform/fswatch.repo for the watcher that copes with the inode swap).
    await fs.promises.rename(tmp, filePath)
    return body
  }

  const handleFileChange = async (room: Room<S>): Promise<void> => {
    let next: S
    try {
      next = await readFromDisk(room.filePath)
    } catch (err) {
      console.error("[docRoom.repo] read failed", room.filePath, err)
      return
    }
    const incomingBody = codec.serialize(next)
    if (room.lastSelfWrite !== null && room.lastSelfWrite === incomingBody) {
      // Our own write just landed — clear the marker and stay silent. Without
      // this every browser-driven edit would round-trip back to every
      // connected tab (including the originator) and stomp on in-flight drags.
      room.lastSelfWrite = null
      return
    }
    if (codec.equal(room.cache, next)) return
    room.cache = next
    for (const sub of room.subscribers.values()) sub(next, false)
  }

  const ensureRoom = async (filePath: string): Promise<Room<S>> => {
    const existing = rooms.get(filePath)
    if (existing) return existing
    const cache = await readFromDisk(filePath)
    const room: Room<S> = {
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

  const getRoomAt = async (filePath: string): Promise<DocRoom<S>> => {
    const room = await ensureRoom(filePath)
    return {
      snapshot: () => room.cache,
      subscribe: (sub) => {
        const key = Symbol("doc-sub")
        room.subscribers.set(key, sub)
        return () => {
          room.subscribers.delete(key)
          // Keep the room alive even with zero subscribers: the file watcher
          // is cheap and the AI can write the document with nobody listening
          // yet. Browsers reconnecting later still see fresh state.
        }
      },
      publish: async (next, origin) => {
        const stamped = codec.stamp(next)
        try {
          const body = await writeAtomic(room.filePath, stamped)
          room.lastSelfWrite = body
        } catch (err) {
          console.error("[docRoom.repo] write failed", room.filePath, err)
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

  const resetForTests = (): void => {
    for (const room of rooms.values()) {
      if (room.unwatch) room.unwatch()
    }
    rooms.clear()
  }

  return { getRoomAt, resetForTests }
}
