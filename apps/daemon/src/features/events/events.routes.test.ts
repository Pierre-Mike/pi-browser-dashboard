import { describe, expect, it } from "bun:test"
import { sseBus } from "../../platform/sse-bus"
import { app } from "./events.routes"

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

type SseEvent = { event: string; data: string; id: string }

type SseStream = {
  readonly read: (count: number, timeoutMs?: number) => Promise<SseEvent[]>
  readonly close: () => Promise<void>
}

// Wrap a single Response stream with a reader that persists across reads, so a
// test can drain the initial heartbeat, publish more events, then read again
// without re-locking the body.
const openSseStream = (res: Response): SseStream => {
  if (!res.body) throw new Error("no body")
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""

  const drainBuffer = (out: SseEvent[], cap: number): void => {
    while (out.length < cap) {
      const idx = buffer.indexOf("\n\n")
      if (idx === -1) break
      const block = buffer.slice(0, idx)
      buffer = buffer.slice(idx + 2)
      let event = "message"
      let data = ""
      let id = ""
      for (const line of block.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim()
        else if (line.startsWith("data:")) data += (data ? "\n" : "") + line.slice(5).trim()
        else if (line.startsWith("id:")) id = line.slice(3).trim()
      }
      out.push({ event, data, id })
    }
  }

  return {
    read: async (count, timeoutMs = 2_000): Promise<SseEvent[]> => {
      const events: SseEvent[] = []
      drainBuffer(events, count)
      const deadline = Date.now() + timeoutMs
      while (events.length < count && Date.now() < deadline) {
        const chunk = await Promise.race<
          ReadableStreamReadResult<Uint8Array> | { value: undefined; done: false }
        >([reader.read(), wait(50).then(() => ({ value: undefined, done: false }))])
        if (chunk.done) break
        if (chunk.value) buffer += decoder.decode(chunk.value, { stream: true })
        drainBuffer(events, count)
      }
      return events
    },
    close: async () => {
      try {
        await reader.cancel()
      } catch {
        // ignore
      }
    },
  }
}

describe("GET /events (SSE)", () => {
  it("emits an immediate heartbeat with connect=true so proxies don't stall the response", async () => {
    const res = await app.request("/")
    const stream = openSseStream(res)
    try {
      expect(res.status).toBe(200)
      expect(res.headers.get("content-type") ?? "").toContain("text/event-stream")
      const [first] = await stream.read(1)
      expect(first?.event).toBe("heartbeat")
      const payload = JSON.parse(first?.data ?? "{}") as { connect?: boolean; t?: number }
      expect(payload.connect).toBe(true)
      expect(typeof payload.t).toBe("number")
    } finally {
      await stream.close()
    }
  })

  it("fans an sseBus publish out to a connected subscriber", async () => {
    const res = await app.request("/")
    const stream = openSseStream(res)
    try {
      // Drain the initial heartbeat first.
      await stream.read(1)
      sseBus.publish({ type: "test.event", data: { hello: "world", n: 7 } })
      const [evt] = await stream.read(1)
      expect(evt?.event).toBe("test.event")
      expect(JSON.parse(evt?.data ?? "null")).toEqual({ hello: "world", n: 7 })
    } finally {
      await stream.close()
    }
  })

  it("serialises data:null when the publish payload is undefined", async () => {
    const res = await app.request("/")
    const stream = openSseStream(res)
    try {
      await stream.read(1)
      sseBus.publish({ type: "void.event", data: undefined })
      const [evt] = await stream.read(1)
      expect(evt?.event).toBe("void.event")
      expect(evt?.data).toBe("null")
    } finally {
      await stream.close()
    }
  })

  it("wraps ext:<name>:* events under a single 'ext' SSE event so the web EventSource can tap them with one listener", async () => {
    const res = await app.request("/")
    const stream = openSseStream(res)
    try {
      await stream.read(1)
      sseBus.publish({ type: "ext:repo-explorer:file-changed", data: { path: "a.ts" } })
      const [evt] = await stream.read(1)
      expect(evt?.event).toBe("ext")
      expect(JSON.parse(evt?.data ?? "null")).toEqual({
        channel: "ext:repo-explorer:file-changed",
        payload: { path: "a.ts" },
      })
    } finally {
      await stream.close()
    }
  })

  it("leaves non-ext event names (session.*, ext:state-changed) under their own event name", async () => {
    const res = await app.request("/")
    const stream = openSseStream(res)
    try {
      await stream.read(1)
      sseBus.publish({ type: "ext:state-changed", data: { name: "x" } })
      const [evt] = await stream.read(1)
      // Lifecycle control event keeps its own name (it is NOT a namespaced
      // ext:<name>:<suffix> channel), so existing listeners are unaffected.
      expect(evt?.event).toBe("ext:state-changed")
    } finally {
      await stream.close()
    }
  })

  it("assigns strictly monotonic ids so reconnects with Last-Event-ID can resume", async () => {
    const res = await app.request("/")
    const stream = openSseStream(res)
    try {
      const [hb] = await stream.read(1)
      sseBus.publish({ type: "a", data: 1 })
      sseBus.publish({ type: "b", data: 2 })
      const evts = await stream.read(2)
      expect(Number(hb?.id)).toBe(1)
      expect(Number(evts[0]?.id)).toBe(2)
      expect(Number(evts[1]?.id)).toBe(3)
    } finally {
      await stream.close()
    }
  })
})
