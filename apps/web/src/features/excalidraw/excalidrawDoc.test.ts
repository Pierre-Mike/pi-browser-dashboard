import { describe, expect, it } from "bun:test"
import {
  docFromElements,
  docStableKey,
  type ExcalidrawDocument,
  emptyExcalidrawDocument,
  excalidrawWsPath,
  parseExcalidrawServerFrame,
} from "./excalidrawDoc"

describe("excalidrawWsPath", () => {
  it("pins the daemon's excalidraw ws route", () => {
    expect(excalidrawWsPath({ projectId: "proj", slug: "sketch" })).toBe(
      "/projects/proj/brainstorms/sketch/excalidraw/ws",
    )
    expect(excalidrawWsPath({ projectId: "a b", slug: "sketch" })).toBe(
      "/projects/a%20b/brainstorms/sketch/excalidraw/ws",
    )
  })
})

describe("docFromElements", () => {
  it("carries the previous document's non-element keys forward", () => {
    const base: ExcalidrawDocument = {
      ...emptyExcalidrawDocument(),
      appState: { viewBackgroundColor: "#123456" },
    }
    const next = docFromElements(base, [{ id: "el1" }])
    expect(next.elements).toEqual([{ id: "el1" }])
    expect(next.appState).toEqual({ viewBackgroundColor: "#123456" })
    expect(next.type).toBe("excalidraw")
  })
})

describe("docStableKey", () => {
  it("keys by elements so viewport-only churn doesn't count as a change", () => {
    const a = docFromElements(emptyExcalidrawDocument(), [{ id: "el1", x: 1 }])
    const b = {
      ...docFromElements(emptyExcalidrawDocument(), [{ id: "el1", x: 1 }]),
      appState: { zoom: 3 },
    }
    const c = docFromElements(emptyExcalidrawDocument(), [{ id: "el1", x: 2 }])
    expect(docStableKey(a)).toBe(docStableKey(b))
    expect(docStableKey(a)).not.toBe(docStableKey(c))
  })
})

describe("parseExcalidrawServerFrame", () => {
  it("accepts snapshot and error frames, rejects everything else", () => {
    const snap = parseExcalidrawServerFrame(
      JSON.stringify({ kind: "snapshot", snapshot: emptyExcalidrawDocument(), origin: "remote" }),
    )
    expect(snap?.kind).toBe("snapshot")
    const err = parseExcalidrawServerFrame(JSON.stringify({ kind: "error", message: "boom" }))
    expect(err?.kind).toBe("error")
    expect(parseExcalidrawServerFrame("not json")).toBe(null)
    expect(parseExcalidrawServerFrame(JSON.stringify({ kind: "snapshot", snapshot: null }))).toBe(
      null,
    )
    expect(parseExcalidrawServerFrame(JSON.stringify({ kind: "other" }))).toBe(null)
  })
})
