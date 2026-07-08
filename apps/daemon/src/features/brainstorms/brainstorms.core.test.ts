import { describe, expect, it } from "bun:test"
import path from "node:path"
import {
  brainstormFileName,
  brainstormIdFromFileName,
  brainstormsDirFor,
  discoverBrainstormIds,
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
  it("round-trips id -> filename -> id", () => {
    expect(brainstormFileName("auth-flow")).toBe("auth-flow.canvas.json")
    expect(brainstormIdFromFileName("auth-flow.canvas.json")).toBe("auth-flow")
  })

  it("returns null for non-brainstorm basenames", () => {
    expect(brainstormIdFromFileName("notes.txt")).toBe(null)
    expect(brainstormIdFromFileName("auth-flow.json")).toBe(null)
    expect(brainstormIdFromFileName(".canvas.json")).toBe(null)
    expect(brainstormIdFromFileName("Bad Name.canvas.json")).toBe(null)
  })

  it("stores documents under <project>/.pid/brainstorms", () => {
    expect(brainstormsDirFor(path.join("/tmp", "proj"))).toBe(
      path.join("/tmp", "proj", ".pid", "brainstorms"),
    )
  })
})

describe("discoverBrainstormIds", () => {
  it("keeps only well-formed documents, sorted alphabetically", () => {
    expect(
      discoverBrainstormIds([
        "zeta.canvas.json",
        "alpha.canvas.json",
        "junk.txt",
        "Bad Name.canvas.json",
        ".canvas.json",
      ]),
    ).toEqual(["alpha", "zeta"])
  })

  it("returns [] for an empty directory", () => {
    expect(discoverBrainstormIds([])).toEqual([])
  })
})
