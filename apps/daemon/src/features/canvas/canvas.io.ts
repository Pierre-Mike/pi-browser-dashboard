import {
  type CanvasSnapshot,
  canvasEqual,
  canvasPathFor,
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

// Keyed by absolute file path — one room per document, whether that document
// is a session canvas (~/.claude/jobs/<short>/canvas.json) or a project
// brainstorm (<project>/.pid/brainstorms/<id>.canvas.json).
const rooms = makeDocRooms(canvasCodec)

export type CanvasRoom = DocRoom<CanvasSnapshot>

// Session-canvas entry point, kept as the narrow public API the canvas routes
// use. Brainstorms (and any future document-backed canvas) go through
// getCanvasRoomAt with an explicit path.
export const getCanvasRoom = (configDir: string, short: string): Promise<CanvasRoom> =>
  getCanvasRoomAt(canvasPathFor({ configDir, short }))

export const getCanvasRoomAt = rooms.getRoomAt

// The slice's room door: both canvas encodings hand back a
// DocRoom<CanvasSnapshot>, so a consumer picks the encoding but never has to
// know which module implements it.
export { __resetJsonCanvasRoomsForTests, getJsonCanvasRoomAt } from "./jsonCanvas.io"

export const __resetCanvasRoomsForTests = rooms.resetForTests
