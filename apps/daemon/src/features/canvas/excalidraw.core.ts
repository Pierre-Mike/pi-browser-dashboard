// Excalidraw document codec. Unlike the React-Flow canvas codec (which decodes
// into a known node/edge shape), an Excalidraw board is treated as opaque
// native-format JSON: the daemon only guards "object with an elements array"
// and otherwise relays the document byte-for-byte, so freedraw strokes,
// bindings, files and future Excalidraw keys survive the round-trip. The
// browser (via Excalidraw's own restoreElements) owns element-level
// normalization.

import { Either } from "effect"

export type ExcalidrawDoc = {
  readonly [key: string]: unknown
  readonly elements: readonly unknown[]
}

// A malformed document is a value, not an exception: the shell turns a `Left`
// into a 400 on the write path and into a read error on the watcher path.
export const parseExcalidrawDoc = (raw: unknown): Either.Either<ExcalidrawDoc, string> => {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return Either.left("excalidraw document must be a JSON object")
  }
  const obj = raw as Record<string, unknown>
  const elements = obj.elements
  if (!Array.isArray(elements)) {
    return Either.left("excalidraw document must have an elements array")
  }
  return Either.right({ ...obj, elements })
}

export const serializeExcalidrawDoc = (doc: ExcalidrawDoc): string => JSON.stringify(doc, null, 2)

export const excalidrawEqual = (input: {
  readonly a: ExcalidrawDoc
  readonly b: ExcalidrawDoc
}): boolean => serializeExcalidrawDoc(input.a) === serializeExcalidrawDoc(input.b)

// The document a freshly created board starts from — same shape Excalidraw's
// own "export to file" produces, so the file is openable anywhere from birth.
export const emptyExcalidrawDoc = (): ExcalidrawDoc => ({
  type: "excalidraw",
  version: 2,
  source: "pi-browser-dashboard",
  elements: [],
  appState: {},
  files: {},
})
