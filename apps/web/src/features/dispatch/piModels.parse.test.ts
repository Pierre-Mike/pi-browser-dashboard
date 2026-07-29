import { describe, expect, it } from "bun:test"
import { parsePiModels } from "./piModels.parse"

describe("parsePiModels", () => {
  it("accepts a well-formed catalog", () => {
    const body = { models: [{ provider: "anthropic", id: "claude-opus-5" }] }
    expect(parsePiModels(body)).toEqual(body.models)
  })

  it("accepts an empty catalog", () => {
    expect(parsePiModels({ models: [] })).toEqual([])
  })

  it("rejects a malformed model entry", () => {
    expect(parsePiModels({ models: [{ provider: "anthropic" }] })).toBeNull()
  })

  it("rejects a missing models field or a non-object body", () => {
    expect(parsePiModels({})).toBeNull()
    expect(parsePiModels(null)).toBeNull()
  })
})
