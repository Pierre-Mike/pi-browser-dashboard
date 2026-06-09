import { describe, expect, it } from "bun:test"
import { createExtensionEventBroker } from "./extensionEvents"

describe("createExtensionEventBroker", () => {
  it("relays a published event to every subscriber", () => {
    const broker = createExtensionEventBroker()
    const a: unknown[] = []
    const b: unknown[] = []
    broker.subscribe((e) => a.push(e))
    broker.subscribe((e) => b.push(e))

    broker.relay({ type: "ext:demo:tick", data: { n: 1 } })

    expect(a).toEqual([{ type: "ext:demo:tick", data: { n: 1 } }])
    expect(b).toEqual([{ type: "ext:demo:tick", data: { n: 1 } }])
  })

  it("stops delivering after unsubscribe", () => {
    const broker = createExtensionEventBroker()
    const seen: unknown[] = []
    const off = broker.subscribe((e) => seen.push(e))
    broker.relay({ type: "ext:demo:a", data: 1 })
    off()
    broker.relay({ type: "ext:demo:b", data: 2 })
    expect(seen).toEqual([{ type: "ext:demo:a", data: 1 }])
  })

  it("isolates a throwing subscriber from the others", () => {
    const broker = createExtensionEventBroker()
    const seen: unknown[] = []
    broker.subscribe(() => {
      throw new Error("boom")
    })
    broker.subscribe((e) => seen.push(e))
    broker.relay({ type: "ext:demo:c", data: 3 })
    expect(seen).toEqual([{ type: "ext:demo:c", data: 3 }])
  })
})
