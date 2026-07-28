import type { QueryClient } from "@tanstack/react-query"
import { parseRunSummary } from "../features/fleet/fleetParse"
import type { RunSummaryWire } from "../features/fleet/types"
import { fleetRunsKey } from "../features/fleet/useFleetRuns"
import { notifyEnabled, showNotification } from "../features/notifications/notifier"
import { decideNotification, resolvePrevState } from "../features/notifications/sessionNotify"
import { type TerminalStateEvent, terminalStateKey } from "../features/terminal/terminalState"
import { TERMINAL_STATES_QUERY_KEY } from "../features/terminal/useTerminalState"
import { extensionEventBroker } from "./extensionEvents"
import type { SessionState, SessionStateValue } from "./types"

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

const upsertRun = (
  prev: readonly RunSummaryWire[] | undefined,
  next: RunSummaryWire,
): readonly RunSummaryWire[] => {
  if (!prev) return [next]
  const idx = prev.findIndex((r) => r.id === next.id)
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
  // Last observed state per session, so we can detect the *edge* into a
  // terminal state and notify only on a transition we actually witnessed.
  // Persists across watchdog reconnects (this closure lives for the app's
  // lifetime), so a reconnect doesn't re-notify already-finished sessions.
  const lastStates = new Map<string, SessionStateValue>()

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

      // Fall back to the roster state the user was looking at (HTTP-fetched,
      // so absent from lastStates) for a session's first SSE event — otherwise
      // the witnessed working→done edge is dropped. Read the cache before the
      // setQueryData below overwrites it with the new state.
      const cachedState = queryClient
        .getQueryData<SessionState[]>(["sessions"])
        ?.find((s) => s.short === payload.short)?.state
      const prevState = resolvePrevState(lastStates.get(payload.short), cachedState)
      lastStates.set(payload.short, payload.state)
      if (notifyEnabled()) {
        const note = decideNotification(prevState, payload)
        if (note) showNotification(note)
      }

      queryClient.setQueryData<SessionState[]>(["sessions"], (prev) => upsertList(prev, payload))
      queryClient.setQueryData<SessionState>(["sessions", payload.short], payload)
      queryClient.invalidateQueries({ queryKey: ["transcript", payload.short] })
    })

    // Namespaced extension events arrive collapsed onto a single "ext" event
    // (see events.routes.ts). Relay them into the in-process broker so each
    // extension iframe taps THIS one EventSource rather than opening its own.
    // Per-iframe least-privilege gating happens in the RPC bridge.
    next.addEventListener("ext", (ev) => {
      mark("ext")
      const payload = parse<{ channel: string; payload: unknown }>((ev as MessageEvent).data)
      if (!payload || typeof payload.channel !== "string") return
      extensionEventBroker.relay({ type: payload.channel, data: payload.payload })
    })

    next.addEventListener("session.created", () => {
      mark("session.created")
      queryClient.invalidateQueries({ queryKey: ["sessions"] })
    })

    next.addEventListener("session.removed", () => {
      mark("session.removed")
      queryClient.invalidateQueries({ queryKey: ["sessions"] })
    })

    // A terminal's agent-state classification changed (see
    // apps/daemon/src/features/terminal/terminal-state.core.ts). Patched
    // straight into the terminal-states cache entry rather than invalidated —
    // there is no REST re-fetch cheaper than the payload already carries.
    next.addEventListener("terminal.state", (ev) => {
      const payload = parse<TerminalStateEvent>((ev as MessageEvent).data)
      if (!payload) return
      mark("terminal.state", { scope: payload.scope, id: payload.id, state: payload.state })
      queryClient.setQueryData<Record<string, TerminalStateEvent>>(
        TERMINAL_STATES_QUERY_KEY,
        (prev) => ({ ...prev, [terminalStateKey(payload)]: payload }),
      )
    })

    // A fleet run transitioned (see apps/daemon/src/features/fleet/fleet-run.io.ts,
    // published on every `advance`). Patched straight into that project's
    // fleet-runs cache entry — useFleetRuns seeds it once via GET, this keeps
    // it live without a re-fetch.
    next.addEventListener("fleet.run", (ev) => {
      const payload = parse<unknown>((ev as MessageEvent).data)
      const run = payload === null ? undefined : parseRunSummary(payload)
      if (!run) return
      mark("fleet.run", { runId: run.id, fleet: run.fleet, status: run.status })
      queryClient.setQueryData<readonly RunSummaryWire[]>(fleetRunsKey(run.projectId), (prev) =>
        upsertRun(prev, run),
      )
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
