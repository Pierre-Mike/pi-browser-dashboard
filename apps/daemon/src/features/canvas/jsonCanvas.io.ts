import type { CanvasSnapshot } from "./canvas.core"
import { type DocCodec, makeDocRooms } from "./docRoom.io"
import {
  emptyJsonCanvas,
  jsonCanvasEqual,
  parseJsonCanvas,
  serializeJsonCanvas,
} from "./jsonCanvas.core"

// Path-keyed live rooms for Obsidian JSON Canvas documents (any `*.canvas` file
// in a session's worktree). The room type is DocRoom<CanvasSnapshot> — the same
// as the React-Flow canvas room — so the websocket handler, the snapshot routes
// and the browser editor are shared; only the bytes on disk differ.
//
// stamp is identity: `.canvas` has no modification-time field, so stamping one
// in would write a key Obsidian does not know and make every save look like a
// content change.

const jsonCanvasCodec: DocCodec<CanvasSnapshot> = {
  parse: parseJsonCanvas,
  serialize: serializeJsonCanvas,
  equal: (a, b) => jsonCanvasEqual({ a, b }),
  empty: emptyJsonCanvas,
  stamp: (snap) => snap,
}

const rooms = makeDocRooms(jsonCanvasCodec)

export const getJsonCanvasRoomAt = rooms.getRoomAt

export const __resetJsonCanvasRoomsForTests = rooms.resetForTests
