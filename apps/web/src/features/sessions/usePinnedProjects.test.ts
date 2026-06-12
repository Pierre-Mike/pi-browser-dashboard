import { describe, expect, it } from "bun:test"
import { parsePinnedIds, reorderPinned, togglePinned } from "./usePinnedProjects"

describe("parsePinnedIds", () => {
  it("round-trips a JSON array of ids, preserving order", () => {
    expect(parsePinnedIds(JSON.stringify(["b", "a", "c"]))).toEqual(["b", "a", "c"])
  })
  it("returns an empty list for null, malformed JSON, or non-arrays", () => {
    expect(parsePinnedIds(null)).toEqual([])
    expect(parsePinnedIds("{not json")).toEqual([])
    expect(parsePinnedIds('{"a":1}')).toEqual([])
  })
  it("drops non-string entries and de-duplicates, keeping first occurrence", () => {
    expect(parsePinnedIds('["a", 7, null, "a", "b"]')).toEqual(["a", "b"])
  })
})

describe("togglePinned", () => {
  it("appends a new id to the end (newest pin sinks below existing order)", () => {
    expect(togglePinned(["a", "b"], "c")).toEqual(["a", "b", "c"])
  })
  it("removes an already-pinned id", () => {
    expect(togglePinned(["a", "b", "c"], "b")).toEqual(["a", "c"])
  })
  it("does not mutate the input", () => {
    const input = ["a"]
    togglePinned(input, "b")
    expect(input).toEqual(["a"])
  })
})

describe("reorderPinned", () => {
  it("moves a dragged id to sit before its target (drag up)", () => {
    expect(reorderPinned(["a", "b", "c"], { draggedId: "c", targetId: "a" })).toEqual([
      "c",
      "a",
      "b",
    ])
  })
  it("moves a dragged id to sit before its target (drag down)", () => {
    expect(reorderPinned(["a", "b", "c"], { draggedId: "a", targetId: "c" })).toEqual([
      "b",
      "a",
      "c",
    ])
  })
  it("is a no-op when dragged and target are the same", () => {
    expect(reorderPinned(["a", "b", "c"], { draggedId: "b", targetId: "b" })).toEqual([
      "a",
      "b",
      "c",
    ])
  })
  it("is a no-op when either id is not pinned", () => {
    expect(reorderPinned(["a", "b"], { draggedId: "x", targetId: "a" })).toEqual(["a", "b"])
    expect(reorderPinned(["a", "b"], { draggedId: "a", targetId: "x" })).toEqual(["a", "b"])
  })
  it("does not mutate the input", () => {
    const input = ["a", "b", "c"]
    reorderPinned(input, { draggedId: "c", targetId: "a" })
    expect(input).toEqual(["a", "b", "c"])
  })
})
