type SseEvent = { readonly type: string; readonly data: unknown }
type SseSubscriber = (event: SseEvent) => void
type Unsubscribe = () => void

type Bus = {
  readonly subscribe: (cb: SseSubscriber) => Unsubscribe
  readonly publish: (event: SseEvent) => void
  // Test-only introspection (e.g. sessions-wait.io.test.ts's leak check) — not
  // used by any production path.
  readonly subscriberCount: () => number
}

const createBus = (): Bus => {
  const subscribers = new Set<SseSubscriber>()
  return {
    subscribe: (cb) => {
      subscribers.add(cb)
      return () => subscribers.delete(cb)
    },
    publish: (event) => {
      for (const cb of subscribers) {
        try {
          cb(event)
        } catch (err) {
          console.error("[sse-bus] subscriber threw", err)
        }
      }
    },
    subscriberCount: () => subscribers.size,
  }
}

export const sseBus: Bus = createBus()
