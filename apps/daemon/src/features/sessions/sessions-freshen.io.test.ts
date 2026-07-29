import { describe, expect, it } from "bun:test"
import { createCoalescedRefresh } from "./sessions-freshen.io"

type Settler = { readonly resolve: () => void; readonly reject: (err: Error) => void }

// A pass whose completion the test controls, so every assertion below is about
// ordering rather than about how long a timer happened to take.
const controllable = (): {
  starts: number
  readonly pass: () => Promise<void>
  readonly releaseAll: () => void
  readonly settleNext: () => Settler | undefined
} => {
  const pending: Settler[] = []
  const state = {
    starts: 0,
    pass: (): Promise<void> => {
      state.starts += 1
      return new Promise<void>((resolve, reject) => {
        pending.push({ resolve: () => resolve(), reject })
      })
    },
    releaseAll: (): void => {
      for (const p of pending.splice(0)) p.resolve()
    },
    settleNext: (): Settler | undefined => pending.shift(),
  }
  return state
}

// Lets the microtask queue drain, so a follow-up pass chained onto a settled
// one has actually started by the time the assertion runs.
const tick = (): Promise<void> => new Promise<void>((r) => setTimeout(r, 0))

describe("createCoalescedRefresh", () => {
  it("runs one pass for a single caller", async () => {
    const c = controllable()
    const gate = createCoalescedRefresh({ pass: c.pass })
    const first = gate.refresh()
    expect(c.starts).toBe(1)
    c.releaseAll()
    await first
  })

  it("collapses a burst of callers into one in-flight pass plus one follow-up", async () => {
    // The cost this exists to remove: every concurrent read used to run its own
    // full pass, so a burst of N reads cost N jobs-dir scans and N stat
    // fan-outs. Two passes is the floor that keeps read-your-writes intact —
    // the in-flight one may already have looked at a file before the later
    // callers wrote it.
    const c = controllable()
    const gate = createCoalescedRefresh({ pass: c.pass })
    const waiters = Array.from({ length: 40 }, () => gate.refresh())
    expect(c.starts).toBe(1)
    c.releaseAll() // the first pass finishes; the single queued follow-up begins
    await tick()
    expect(c.starts).toBe(2)
    c.releaseAll()
    await Promise.all(waiters)
    expect(c.starts).toBe(2)
  })

  it("resolves a late caller only after a pass that began after it called", async () => {
    // The invariant refresh-on-read exists for: a caller must never be handed
    // the result of a pass that had already read the disk before the caller's
    // own write landed.
    const c = controllable()
    const gate = createCoalescedRefresh({ pass: c.pass })
    const early = gate.refresh()
    const passesRunningWhenLateCalled = c.starts
    const late = gate.refresh()
    let lateSettled = false
    void late.then(() => {
      lateSettled = true
    })
    c.settleNext()?.resolve() // the first pass completes
    await early
    await tick()
    expect(lateSettled).toBe(false)
    expect(c.starts).toBe(passesRunningWhenLateCalled + 1)
    c.settleNext()?.resolve()
    await late
    expect(lateSettled).toBe(true)
  })

  it("gives a caller arriving after the burst settled its own pass", async () => {
    const c = controllable()
    const gate = createCoalescedRefresh({ pass: c.pass })
    const first = gate.refresh()
    c.releaseAll()
    await first
    const second = gate.refresh()
    expect(c.starts).toBe(2)
    c.releaseAll()
    await second
  })

  it("propagates a failing pass to its caller without wedging the gate", async () => {
    const c = controllable()
    const gate = createCoalescedRefresh({ pass: c.pass })
    const first = gate.refresh()
    c.settleNext()?.reject(new Error("boom"))
    await expect(first).rejects.toThrow("boom")
    const second = gate.refresh()
    expect(c.starts).toBe(2)
    c.releaseAll()
    await second
  })

  it("still runs the queued follow-up when the in-flight pass rejects", async () => {
    const c = controllable()
    const gate = createCoalescedRefresh({ pass: c.pass })
    const first = gate.refresh()
    const queued = gate.refresh()
    c.settleNext()?.reject(new Error("boom"))
    await expect(first).rejects.toThrow("boom")
    await tick()
    expect(c.starts).toBe(2)
    c.settleNext()?.resolve()
    await queued
  })
})
