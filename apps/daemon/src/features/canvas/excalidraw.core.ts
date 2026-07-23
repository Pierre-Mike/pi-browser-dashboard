// Excalidraw document codec. Unlike the React-Flow canvas codec (which decodes
// into a known node/edge shape), an Excalidraw board is treated as opaque
// native-format JSON: the daemon only guards "object with an elements array"
// and otherwise relays the document byte-for-byte, so freedraw strokes,
// bindings, files and future Excalidraw keys survive the round-trip. The
// browser (via Excalidraw's own restoreElements) owns element-level
// normalization.

export type ExcalidrawDoc = {
  readonly [key: string]: unknown
  readonly elements: readonly unknown[]
}

export const parseExcalidrawDoc = (raw: unknown): ExcalidrawDoc => {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error("excalidraw document must be a JSON object")
  }
  const obj = raw as Record<string, unknown>
  const elements = obj.elements
  if (!Array.isArray(elements)) {
    throw new Error("excalidraw document must have an elements array")
  }
  return { ...obj, elements }
}

export const serializeExcalidrawDoc = (doc: ExcalidrawDoc): string => JSON.stringify(doc, null, 2)

export const excalidrawEqual = (a: ExcalidrawDoc, b: ExcalidrawDoc): boolean =>
  serializeExcalidrawDoc(a) === serializeExcalidrawDoc(b)

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
