import { describe, expect, it } from "bun:test"
import { emitDroppedPath, subscribeDroppedPaths } from "./dropEvents"

describe("drop event bus", () => {
  it("delivers emitted paths to subscribers", () => {
    const received: string[] = []
    const off = subscribeDroppedPaths((p) => received.push(p))
    emitDroppedPath("/abs/one.txt")
    emitDroppedPath("/abs/two.txt")
    expect(received).toEqual(["/abs/one.txt", "/abs/two.txt"])
    off()
  })

  it("stops delivering after the unsubscribe handle is called", () => {
    const received: string[] = []
    const off = subscribeDroppedPaths((p) => received.push(p))
    emitDroppedPath("/abs/one.txt")
    off()
    emitDroppedPath("/abs/two.txt")
    expect(received).toEqual(["/abs/one.txt"])
  })

  it("supports multiple independent subscribers", () => {
    const a: string[] = []
    const b: string[] = []
    const offA = subscribeDroppedPaths((p) => a.push(p))
    const offB = subscribeDroppedPaths((p) => b.push(p))
    emitDroppedPath("/abs/x")
    expect(a).toEqual(["/abs/x"])
    expect(b).toEqual(["/abs/x"])
    offA()
    offB()
  })
})
