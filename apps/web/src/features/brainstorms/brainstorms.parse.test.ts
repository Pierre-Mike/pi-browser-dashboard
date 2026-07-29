import { describe, expect, it } from "bun:test"
import type { Brainstorm, BrainstormKind } from "./brainstorms"
import { parseBrainstorm, parseBrainstorms } from "./brainstorms.parse"

const valid: Brainstorm = {
  path: "brainstorms/a.canvas",
  label: "a",
  kind: "canvas",
  file: "/repo/brainstorms/a.canvas",
  updatedAt: "2026-06-13T00:00:00Z",
}

describe("parseBrainstorm", () => {
  it("accepts a well-formed board", () => {
    expect(parseBrainstorm(valid)).toEqual(valid)
  })

  it("accepts every known kind", () => {
    const kinds: readonly BrainstormKind[] = ["canvas", "canvasJson", "excalidraw"]
    for (const kind of kinds) {
      expect(parseBrainstorm({ ...valid, kind })?.kind).toBe(kind)
    }
  })

  it("rejects an unrecognized kind", () => {
    expect(parseBrainstorm({ ...valid, kind: "pdf" })).toBeNull()
  })

  it("rejects a missing field", () => {
    const { label, ...rest } = valid
    expect(parseBrainstorm(rest)).toBeNull()
  })

  it("rejects a non-object", () => {
    expect(parseBrainstorm(null)).toBeNull()
    expect(parseBrainstorm("board")).toBeNull()
  })
})

describe("parseBrainstorms", () => {
  it("parses a list", () => {
    expect(parseBrainstorms([valid])).toEqual([valid])
  })

  it("fails the whole list on one bad entry", () => {
    expect(parseBrainstorms([valid, { ...valid, kind: "pdf" }])).toBeNull()
  })
})
