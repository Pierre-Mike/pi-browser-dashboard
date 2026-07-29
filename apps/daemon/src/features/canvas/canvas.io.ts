import {
  type CanvasSnapshot,
  canvasEqual,
  emptyCanvas,
  parseCanvas,
  serializeCanvas,
} from "./canvas.core"
import { type DocCodec, type DocRoom, makeDocRooms } from "./docRoom.io"

// Per-document rooms for the React-Flow canvas — the room mechanics live in
// the codec-generic docRoom.repo factory (shared with the Excalidraw board);
// this module contributes the canvas codec and keeps the original public API.

const canvasCodec: DocCodec<CanvasSnapshot> = {
  parse: parseCanvas,
  serialize: serializeCanvas,
  equal: (a, b) => canvasEqual({ a, b }),
  empty: emptyCanvas,
  // Publish stamps updatedAt so consumers can age snapshots.
  stamp: (snap) => ({ ...snap, updatedAt: new Date().toISOString() }),
}

// Keyed by absolute file path — one room per document. Every document is a
// brainstorm board: any `*.canvas` / `*.canvas.json` file in the session's
// worktree.
const rooms = makeDocRooms(canvasCodec)

export type CanvasRoom = DocRoom<CanvasSnapshot>

export const getCanvasRoomAt = rooms.getRoomAt

// The slice's room door: both canvas encodings hand back a
// DocRoom<CanvasSnapshot>, so a consumer picks the encoding but never has to
// know which module implements it.
export { __resetJsonCanvasRoomsForTests, getJsonCanvasRoomAt } from "./jsonCanvas.io"

export const __resetCanvasRoomsForTests = rooms.resetForTests
