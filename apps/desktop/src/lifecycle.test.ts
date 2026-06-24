import { describe, expect, it } from "bun:test"
import { makeShutdown, type Stoppable } from "./lifecycle"

describe("makeShutdown", () => {
  it("stops the daemon when it has booted", () => {
    let stopped = false
    const daemon: Stoppable = {
      stop: async () => {
        stopped = true
      },
    }
    makeShutdown(() => daemon)()
    expect(stopped).toBe(true)
  })

  it("is a no-op while the daemon is still booting (null)", () => {
    expect(() => makeShutdown(() => null)()).not.toThrow()
  })
})
