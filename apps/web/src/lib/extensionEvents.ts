// In-process pub/sub broker that fans daemon SSE events out to extension RPC
// bridges. The single app-wide EventSource (lib/sse.ts) relays events here so
// each sandboxed iframe taps the SAME upstream stream instead of opening its
// own EventSource. Forwarding into a given iframe is then gated, per event, by
// the pure `shouldForwardEvent` decision in features/extensions/rpc.ts.

export type BusEvent = { readonly type: string; readonly data: unknown }
export type EventListener = (event: BusEvent) => void
export type Unsubscribe = () => void

export type ExtensionEventBroker = {
  readonly subscribe: (cb: EventListener) => Unsubscribe
  readonly relay: (event: BusEvent) => void
}

export const createExtensionEventBroker = (): ExtensionEventBroker => {
  const listeners = new Set<EventListener>()
  return {
    subscribe: (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    relay: (event) => {
      for (const cb of listeners) {
        try {
          cb(event)
        } catch (err) {
          console.error("[extensionEvents] subscriber threw", err)
        }
      }
    },
  }
}

// App-wide singleton broker. `startSse` relays into it; `mountRpcBridge`
// subscribes from it. Tests construct their own broker via the factory.
export const extensionEventBroker: ExtensionEventBroker = createExtensionEventBroker()
