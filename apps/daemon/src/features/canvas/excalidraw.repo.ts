import { type DocCodec, type DocRoom, makeDocRooms } from "./docRoom.repo"
import {
  type ExcalidrawDoc,
  emptyExcalidrawDoc,
  excalidrawEqual,
  parseExcalidrawDoc,
  serializeExcalidrawDoc,
} from "./excalidraw.core"

// Path-keyed live rooms for Excalidraw brainstorm boards
// (<project>/.pid/brainstorms/<id>.excalidraw). stamp is identity: the file
// on disk stays exactly what the browser (or an agent) wrote, so it remains
// openable by Excalidraw itself.

const excalidrawCodec: DocCodec<ExcalidrawDoc> = {
  parse: parseExcalidrawDoc,
  serialize: serializeExcalidrawDoc,
  equal: excalidrawEqual,
  empty: emptyExcalidrawDoc,
  stamp: (doc) => doc,
}

const rooms = makeDocRooms(excalidrawCodec)

export type ExcalidrawRoom = DocRoom<ExcalidrawDoc>

export const getExcalidrawRoomAt = rooms.getRoomAt

export const __resetExcalidrawRoomsForTests = rooms.resetForTests
