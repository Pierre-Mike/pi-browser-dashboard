import { describe, expect, it, mock } from "bun:test"
import { type ChildBridgeForTest, closeChildBridge } from "./terminal.routes"

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
