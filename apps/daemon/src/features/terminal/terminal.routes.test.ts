import { describe, expect, it, mock } from "bun:test"
import {
  app,
  type ChildBridgeForTest,
  closeChildBridge,
  resolveClaudeSession,
  resolvePiSession,
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
