import { Hono } from "hono"
import { streamSSE } from "hono/streaming"
import { sseBus } from "../../platform/sse-bus"

const HEARTBEAT_MS = 15_000

type Queued = { readonly event: string; readonly data: string; readonly id: string }

// Namespaced extension events are `ext:<name>:<suffix>`. The browser's
// EventSource cannot wildcard-subscribe to dynamic event names, so we collapse
// every namespaced ext channel onto ONE static SSE event ("ext") carrying
// `{ channel, payload }`. The web app taps it with a single listener and fans
// it into the per-iframe RPC bridge. Lifecycle control events (`ext:state-changed`,
// `ext:skipped`) have only two segments and keep their own event name so
// existing listeners are unaffected.
const isNamespacedExtChannel = (type: string): boolean =>
  type.startsWith("ext:") && type.split(":").length >= 3

const toQueued = ({ type, data, id }: { type: string; data: unknown; id: string }): Queued => {
  if (isNamespacedExtChannel(type)) {
    return { event: "ext", data: JSON.stringify({ channel: type, payload: data ?? null }), id }
  }
  return { event: type, data: JSON.stringify(data ?? null), id }
}

const app = new Hono().get("/", (c) => {
  return streamSSE(c, async (stream) => {
    let nextId = 0
    const queue: Queued[] = []
    let resolveWaiter: (() => void) | null = null
    const wake = (): void => {
      if (resolveWaiter) {
        const r = resolveWaiter
        resolveWaiter = null
        r()
      }
    }

    const unsubscribe = sseBus.subscribe((ev) => {
      nextId++
      queue.push(toQueued({ type: ev.type, data: ev.data, id: String(nextId) }))
      wake()
    })

    stream.onAbort(() => {
      unsubscribe()
      wake()
    })

    // Flush headers and prove liveness immediately so proxies (Vite's
    // http-proxy-middleware in particular) don't hold the response until
    // the first heartbeat 15s later.
    nextId++
    await stream.writeSSE({
      event: "heartbeat",
      data: JSON.stringify({ t: Date.now(), connect: true }),
      id: String(nextId),
    })

    let lastBeat = Date.now()
    while (!stream.aborted) {
      while (queue.length > 0 && !stream.aborted) {
        const msg = queue.shift()
        if (!msg) break
        await stream.writeSSE(msg)
      }
      if (stream.aborted) break

      const now = Date.now()
      const sinceBeat = now - lastBeat
      if (sinceBeat >= HEARTBEAT_MS) {
        nextId++
        await stream.writeSSE({
          event: "heartbeat",
          data: JSON.stringify({ t: now }),
          id: String(nextId),
        })
        lastBeat = now
        continue
      }

      const waitMs = HEARTBEAT_MS - sinceBeat
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          resolveWaiter = null
          resolve()
        }, waitMs)
        resolveWaiter = () => {
          clearTimeout(timer)
          resolve()
        }
      })
    }

    unsubscribe()
  })
})

export { app }
