import { describe, expect, it } from "bun:test"
import path from "node:path"
import {
  brainstormDocFromFileName,
  brainstormFileNameFor,
  brainstormsDirFor,
  discoverBrainstormDocs,
  isCreatableBrainstormName,
} from "./brainstorms.core"

describe("isCreatableBrainstormName", () => {
  it("accepts kebab/dotted lowercase names", () => {
    expect(isCreatableBrainstormName("auth-flow")).toBe(true)
    expect(isCreatableBrainstormName("v2.design")).toBe(true)
    expect(isCreatableBrainstormName("a")).toBe(true)
  })

  it("rejects names that could escape a path segment or break a URL param", () => {
    expect(isCreatableBrainstormName("")).toBe(false)
    expect(isCreatableBrainstormName("Bad Name")).toBe(false)
    expect(isCreatableBrainstormName("../etc")).toBe(false)
    expect(isCreatableBrainstormName("a/b")).toBe(false)
    expect(isCreatableBrainstormName(".hidden")).toBe(false)
    expect(isCreatableBrainstormName("UPPER")).toBe(false)
  })
})

describe("brainstorm file naming", () => {
  it("round-trips id -> filename -> {id, kind} for both kinds", () => {
    expect(brainstormFileNameFor("auth-flow", "canvas")).toBe("auth-flow.canvas.json")
    expect(brainstormDocFromFileName("auth-flow.canvas.json")).toEqual({
      id: "auth-flow",
      kind: "canvas",
    })
    expect(brainstormFileNameFor("sketch", "excalidraw")).toBe("sketch.excalidraw")
    expect(brainstormDocFromFileName("sketch.excalidraw")).toEqual({
      id: "sketch",
      kind: "excalidraw",
    })
  })

  it("returns null for non-brainstorm basenames", () => {
    expect(brainstormDocFromFileName("notes.txt")).toBe(null)
    expect(brainstormDocFromFileName("auth-flow.json")).toBe(null)
    expect(brainstormDocFromFileName(".canvas.json")).toBe(null)
    expect(brainstormDocFromFileName(".excalidraw")).toBe(null)
    expect(brainstormDocFromFileName("Bad Name.canvas.json")).toBe(null)
    expect(brainstormDocFromFileName("Bad Name.excalidraw")).toBe(null)
  })

  it("stores documents under <project>/.pid/brainstorms", () => {
    expect(brainstormsDirFor(path.join("/tmp", "proj"))).toBe(
      path.join("/tmp", "proj", ".pid", "brainstorms"),
    )
  })
})

describe("discoverBrainstormDocs", () => {
  it("keeps only well-formed documents of either kind, sorted alphabetically", () => {
    expect(
      discoverBrainstormDocs([
        "zeta.canvas.json",
        "alpha.canvas.json",
        "sketch.excalidraw",
        "junk.txt",
        "Bad Name.canvas.json",
        ".canvas.json",
      ]),
    ).toEqual([
      { id: "alpha", kind: "canvas" },
      { id: "sketch", kind: "excalidraw" },
      { id: "zeta", kind: "canvas" },
    ])
  })

  it("prefers the canvas document when both kinds share an id", () => {
    expect(discoverBrainstormDocs(["dup.excalidraw", "dup.canvas.json"])).toEqual([
      { id: "dup", kind: "canvas" },
    ])
  })

  it("returns [] for an empty directory", () => {
    expect(discoverBrainstormDocs([])).toEqual([])
  })
})
