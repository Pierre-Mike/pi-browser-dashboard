// Pure helpers for the Excalidraw board feature — no React, no I/O — so the
// wire paths and change-detection rules are unit-testable (repo convention,
// mirrors canvas/canvasUrl.ts + canvas/canvasSync.ts).

export type ExcalidrawDocument = {
  readonly [key: string]: unknown
  readonly elements: readonly unknown[]
}

export const emptyExcalidrawDocument = (): ExcalidrawDocument => ({
  type: "excalidraw",
  version: 2,
  source: "pi-browser-dashboard",
  elements: [],
  appState: {},
  files: {},
})

// Pins the daemon's excalidraw ws route (see brainstorms.routes.ts).
export const excalidrawWsPath = (ref: {
  readonly projectId: string
  readonly slug: string
}): string => `/projects/${encodeURIComponent(ref.projectId)}/brainstorms/${ref.slug}/excalidraw/ws`

// The next wire document after a local edit: same non-element keys, new
// elements. Excalidraw owns appState churn (zoom, scroll, selection) which we
// deliberately do NOT persist per keystroke — elements are the drawing.
export const docFromElements = (
  base: ExcalidrawDocument,
  elements: readonly unknown[],
): ExcalidrawDocument => ({ ...base, elements })

// Change detection keys on elements only, so viewport/selection churn never
// hits the wire.
export const docStableKey = (doc: ExcalidrawDocument): string => JSON.stringify(doc.elements)

export type ExcalidrawServerFrame =
  | { readonly kind: "snapshot"; readonly snapshot: ExcalidrawDocument; readonly origin: string }
  | { readonly kind: "error"; readonly message: string }

const isDocument = (v: unknown): v is ExcalidrawDocument =>
  typeof v === "object" && v !== null && Array.isArray((v as { elements?: unknown }).elements)

// Defensive decode of a server frame; null for anything malformed so the
// socket handler can just skip it.
export const parseExcalidrawServerFrame = (raw: string): ExcalidrawServerFrame | null => {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof parsed !== "object" || parsed === null) return null
  const obj = parsed as Record<string, unknown>
  if (obj.kind === "error" && typeof obj.message === "string") {
    return { kind: "error", message: obj.message }
  }
  if (obj.kind === "snapshot" && isDocument(obj.snapshot)) {
    return {
      kind: "snapshot",
      snapshot: obj.snapshot,
      origin: typeof obj.origin === "string" ? obj.origin : "remote",
    }
  }
  return null
}
