import { describe, expect, it, mock } from "bun:test"
import { sseBus } from "../../platform/sse-bus"
import {
  app,
  type ChildBridgeForTest,
  closeChildBridge,
  readTerminalState,
  resolveClaudeSession,
  resolvePiSession,
  subscribeTerminalScreens,
} from "./terminal.routes"

const makeChild = (opts?: {
  killThrows?: boolean
  onExited?: () => void
}): Pick<ChildBridgeForTest, "kill" | "exited"> => {
  const killFn = mock(() => {
    if (opts?.killThrows) throw new Error("already exited")
  })
  const onExited = opts?.onExited
  const exited = Promise.resolve(0).then((v) => {
    onExited?.()
    return v
  })
  return { kill: killFn, exited }
}

describe("closeChildBridge", () => {
  it("calls child.kill()", async () => {
    const child = makeChild()
    await closeChildBridge({ child, sizedir: "/tmp/nonexistent-pid-test-dir", delayMs: 0 })
    expect(child.kill).toHaveBeenCalledTimes(1)
  })

  it("observes child.exited so Bun reaps the subprocess (no zombie)", async () => {
    let reaped = false
    const child = makeChild({
      onExited: () => {
        reaped = true
      },
    })
    await closeChildBridge({ child, sizedir: "/tmp/nonexistent-pid-test-dir", delayMs: 0 })
    // Flush microtask queue — void child.exited schedules the .then() callback
    await Promise.resolve()
    expect(reaped).toBe(true)
  })

  it("kill() throwing (already exited) does not prevent reap", async () => {
    let reaped = false
    const child = makeChild({
      killThrows: true,
      onExited: () => {
        reaped = true
      },
    })
    // Must not throw
    await closeChildBridge({ child, sizedir: "/tmp/nonexistent-pid-test-dir", delayMs: 0 })
    await Promise.resolve()
    expect(reaped).toBe(true)
  })

  it("does not reference WebSocket — no double-close risk", async () => {
    // closeChildBridge signature accepts no ws argument; the onOpen child.exited
    // handler that sends exitMessage is independent and already wrapped in try/catch.
    const child = makeChild()
    await closeChildBridge({ child, sizedir: "/tmp/nonexistent-pid-test-dir", delayMs: 0 })
    expect(child.kill).toHaveBeenCalledTimes(1)
  })
})

describe("GET /terminal/states", () => {
  it("responds with an object even before any terminal has been classified", async () => {
    const res = await app.request("/states")
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(typeof body).toBe("object")
  })

  it("is matched ahead of the /:id catch-all — a literal 'states' id can't shadow it", async () => {
    // If registration order regressed and /:id ran first, this request would
    // hit the WS upgrade handler for session id "states" instead (which
    // Hono's fetch() would 500 on, not 200 with a plain JSON body).
    const res = await app.request("/states")
    expect(res.headers.get("content-type")).toContain("application/json")
  })
})

// The published door other slices read the polled screen state through — the
// sessions slice's waits and `explain` receive it as an injected port from
// api.ts rather than importing this module. It must never throw or invent a
// record for a terminal nothing has classified.
describe("readTerminalState", () => {
  it("returns undefined for a terminal that has never been classified", () => {
    expect(readTerminalState({ scope: "session", id: "no-such-short" })).toBeUndefined()
  })

  it("returns undefined for an unknown scope rather than falling back", () => {
    expect(readTerminalState({ scope: "not-a-scope", id: "global" })).toBeUndefined()
  })

  it("keys by scope AND id — the same id under another scope is a different terminal", () => {
    // Both are unclassified here; the point is that the lookup is keyed on the
    // pair, so neither can answer for the other.
    expect(readTerminalState({ scope: "session", id: "global" })).toBeUndefined()
    expect(readTerminalState({ scope: "global", id: "global" })).toBeUndefined()
  })
})

// The in-process channel `wait --until-output` resolves off. It exists instead
// of putting screen text on the SSE bus, which every browser is subscribed to.
describe("subscribeTerminalScreens", () => {
  it("hands the unsubscribe back, and stops delivering once it is called", () => {
    const seen: string[] = []
    const off = subscribeTerminalScreens((s) => seen.push(`${s.scope}:${s.id}`))
    expect(typeof off).toBe("function")
    off()
    // Calling it twice must not throw — the wait's interruption finalizer and
    // its settle path can both run.
    expect(() => off()).not.toThrow()
    expect(seen).toEqual([])
  })

  it("does not publish screen text on the SSE bus", () => {
    const busEvents: string[] = []
    const offBus = sseBus.subscribe((e) => busEvents.push(e.type))
    const off = subscribeTerminalScreens(() => {})
    off()
    offBus()
    // Subscribing and unsubscribing is not itself an event, and no code path
    // here may ever put a `terminal.screen` (or any text-bearing) event on the
    // bus — that is the invariant this channel exists to preserve.
    expect(busEvents).not.toContain("terminal.screen")
  })
})

// A prefixed daemon must namespace EVERY name it derives, including the two
// per-session ones. If one path stayed unprefixed, a test or second-checkout
// daemon would attach to (and its DELETE would kill) the user's real session.
describe("session resolvers honour PID_ZELLIJ_PREFIX", () => {
  const session = { short: "ab12", cwd: "/repo", sessionId: "ab12-uuid" } as Parameters<
    typeof resolveClaudeSession
  >[0]["session"]

  it("leaves the claude session name untouched with no prefix", () => {
    const r = resolveClaudeSession({ session, zellijPrefix: "" })
    expect(r.ok && r.sessionName).toBe("ab12")
  })

  it("namespaces the claude session name, in both the name and the command", () => {
    const r = resolveClaudeSession({ session, zellijPrefix: "e2e" })
    expect(r.ok && r.sessionName).toBe("e2e-ab12")
    expect(r.ok && r.cmd).toContain("'e2e-ab12'")
    // The inner `claude attach <short>` targets the session id, not the zellij
    // session, so it must NOT pick up the prefix.
    expect(r.ok && r.cmd).toContain("claude attach")
  })

  it("leaves the pi session name untouched with no prefix", () => {
    const r = resolvePiSession({ pi: session, zellijPrefix: "" })
    expect(r.ok && r.sessionName).toBe("pi-ab12")
  })

  it("namespaces the pi session name, in both the name and the command", () => {
    const r = resolvePiSession({ pi: session, zellijPrefix: "e2e" })
    expect(r.ok && r.sessionName).toBe("e2e-pi-ab12")
    expect(r.ok && r.cmd).toContain("'e2e-pi-ab12'")
  })
})
