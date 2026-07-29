import { describe, expect, it } from "bun:test"
import { Either } from "effect"
import {
  parseExcalidrawDoc as decodeExcalidrawDoc,
  type ExcalidrawDoc,
  emptyExcalidrawDoc,
  excalidrawEqual,
  serializeExcalidrawDoc,
} from "./excalidraw.core"

// The decoder returns Either. Happy paths unwrap; the failure contract is
// asserted directly on the Left below.
const parseExcalidrawDoc = (raw: unknown): ExcalidrawDoc => {
  const decoded = decodeExcalidrawDoc(raw)
  if (Either.isLeft(decoded)) throw new Error(decoded.left)
  return decoded.right
}

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

  it("returns a Left for non-objects and documents without an elements array", () => {
    expect(decodeExcalidrawDoc(null)).toEqual(
      Either.left("excalidraw document must be a JSON object"),
    )
    expect(Either.isLeft(decodeExcalidrawDoc([]))).toBe(true)
    expect(Either.isLeft(decodeExcalidrawDoc("{}"))).toBe(true)
    expect(decodeExcalidrawDoc({ type: "excalidraw" })).toEqual(
      Either.left("excalidraw document must have an elements array"),
    )
    expect(Either.isLeft(decodeExcalidrawDoc({ elements: {} }))).toBe(true)
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
    expect(excalidrawEqual({ a, b })).toBe(true)
    expect(excalidrawEqual({ a, b: c })).toBe(false)
  })
})
