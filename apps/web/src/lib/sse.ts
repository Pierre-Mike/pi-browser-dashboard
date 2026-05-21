import type { QueryClient } from "@tanstack/react-query"
import type { SessionState } from "./types"

type SsePatcher = {
  close: () => void
}

const parse = <T>(raw: string): T | null => {
  try {
    return JSON.parse(raw) as T
  } catch (err) {
    console.error("sse: bad payload", err)
    return null
  }
}

const upsertList = (prev: SessionState[] | undefined, next: SessionState): SessionState[] => {
  if (!prev) return [next]
  const idx = prev.findIndex((s) => s.short === next.short)
  if (idx < 0) return [next, ...prev]
  const copy = prev.slice()
  copy[idx] = next
  return copy
}

// The daemon emits a heartbeat every 15s. If we haven't seen anything in 25s
// (heartbeat + a generous slack), assume the upstream went silent — the most
// common cause is a daemon restart through Vite's proxy, which keeps the
// downstream socket open without forwarding new events. Force a fresh
// EventSource so we re-attach to whatever daemon is now serving /events.
const SILENCE_THRESHOLD_MS = 25_000
const WATCHDOG_INTERVAL_MS = 5_000

export const startSse = (queryClient: QueryClient): SsePatcher => {
  let es: EventSource | null = null
  let lastEventAt = Date.now()
  let closed = false

  const log = (name: string, data?: unknown) => {
    if (
      typeof window !== "undefined" &&
      (window as { __PID_SSE_DEBUG__?: boolean }).__PID_SSE_DEBUG__
    ) {
      console.warn(`[sse] ${name}`, data ?? "")
    }
  }

  const mark = (name: string, data?: unknown): void => {
    lastEventAt = Date.now()
    log(name, data)
  }

  const connect = (): void => {
    if (closed) return
    const next = new EventSource("/events")

    next.addEventListener("open", () => mark("open"))
    next.addEventListener("heartbeat", () => mark("heartbeat"))

    next.addEventListener("roster.changed", () => {
      mark("roster.changed")
      queryClient.invalidateQueries({ queryKey: ["sessions"] })
    })

    next.addEventListener("session.state", (ev) => {
      const payload = parse<SessionState>((ev as MessageEvent).data)
      if (!payload) return
      mark("session.state", { short: payload.short, state: payload.state })
      queryClient.setQueryData<SessionState[]>(["sessions"], (prev) => upsertList(prev, payload))
      queryClient.setQueryData<SessionState>(["sessions", payload.short], payload)
      queryClient.invalidateQueries({ queryKey: ["transcript", payload.short] })
    })

    next.addEventListener("session.created", () => {
      mark("session.created")
      queryClient.invalidateQueries({ queryKey: ["sessions"] })
    })

    next.addEventListener("session.removed", () => {
      mark("session.removed")
      queryClient.invalidateQueries({ queryKey: ["sessions"] })
    })

    next.onerror = (err) => {
      log("error", { readyState: next.readyState })
      console.error("sse: connection error", err)
    }

    es = next
  }

  const reconnect = (): void => {
    log("watchdog reconnect")
    if (es) es.close()
    es = null
    connect()
    lastEventAt = Date.now()
    queryClient.invalidateQueries({ queryKey: ["sessions"] })
  }

  connect()

  const watchdog = setInterval(() => {
    if (closed) return
    if (Date.now() - lastEventAt > SILENCE_THRESHOLD_MS) reconnect()
  }, WATCHDOG_INTERVAL_MS)

  return {
    close: () => {
      closed = true
      clearInterval(watchdog)
      if (es) es.close()
      es = null
    },
  }
}
