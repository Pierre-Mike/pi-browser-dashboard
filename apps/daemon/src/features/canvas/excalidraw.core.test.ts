import { describe, expect, it } from "bun:test"
import {
  emptyExcalidrawDoc,
  excalidrawEqual,
  parseExcalidrawDoc,
  serializeExcalidrawDoc,
} from "./excalidraw.core"

describe("parseExcalidrawDoc", () => {
  it("passes a native Excalidraw document through untouched (unknown keys kept)", () => {
    const raw = {
      type: "excalidraw",
      version: 2,
      source: "https://excalidraw.com",
      elements: [
        {
          id: "el1",
          type: "freedraw",
          points: [
            [0, 0],
            [3, 4],
          ],
          pressures: [0.5, 0.6],
          customFutureKey: true,
        },
      ],
      appState: { viewBackgroundColor: "#ffffff" },
      files: {},
    }
    const doc = parseExcalidrawDoc(raw)
    expect(JSON.parse(serializeExcalidrawDoc(doc))).toEqual(raw)
  })

  it("rejects non-objects and documents without an elements array", () => {
    expect(() => parseExcalidrawDoc(null)).toThrow()
    expect(() => parseExcalidrawDoc([])).toThrow()
    expect(() => parseExcalidrawDoc("{}")).toThrow()
    expect(() => parseExcalidrawDoc({ type: "excalidraw" })).toThrow()
    expect(() => parseExcalidrawDoc({ elements: {} })).toThrow()
  })
})

describe("emptyExcalidrawDoc", () => {
  it("is a valid native document with no elements", () => {
    const empty = emptyExcalidrawDoc()
    expect(empty.elements).toEqual([])
    expect(parseExcalidrawDoc(JSON.parse(serializeExcalidrawDoc(empty)))).toEqual(empty)
  })
})

describe("excalidrawEqual", () => {
  it("compares documents by content", () => {
    const a = parseExcalidrawDoc({ type: "excalidraw", version: 2, elements: [{ id: "x" }] })
    const b = parseExcalidrawDoc({ type: "excalidraw", version: 2, elements: [{ id: "x" }] })
    const c = parseExcalidrawDoc({ type: "excalidraw", version: 2, elements: [{ id: "y" }] })
    expect(excalidrawEqual(a, b)).toBe(true)
    expect(excalidrawEqual(a, c)).toBe(false)
  })
})
