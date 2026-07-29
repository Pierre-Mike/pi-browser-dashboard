// Scheduling half of the session registry's refresh-on-read.
//
// Every read of the registry reconciles the disk first (see `ensureFresh` in
// sessions.io.ts), because a long-lived Bun process has been observed to lose
// its whole timer subsystem while its sockets kept serving — so the watchers
// cannot be the only thing keeping the registry fresh. That pass is O(job
// dirs): one readdir, one existsSync per dir and one stat per watched
// state.json. Measured on a machine with 251 job dirs it is 0.58ms of
// syscalls, and it grows linearly — 8.5ms at 2024 dirs.
//
// Paid once per burst that is fine. It used to be paid once per *reader*: the
// old scheduler chained passes (`freshen = freshen.then(run)`), which serializes
// them but shares nothing, so twenty concurrent reads ran twenty full passes
// back to back. Measured against a real registry: a 20-read burst cost 22.7ms
// at 250 job dirs and 110.4ms at 1000 — 20-25x a single read, on the daemon's
// only thread. The cost therefore scaled with readers TIMES job dirs, and both
// of those grow the longer the dashboard runs.
//
// Two passes is the floor, not one. A reader that arrives while a pass is
// already running cannot be satisfied by it: that pass may have stat'ed the
// file before the reader's own write landed, and refresh-on-read exists
// precisely so a write is visible to the very next read. So a reader either
// starts a pass (none running) or waits for the NEXT one — and every reader
// that arrives during the same in-flight pass waits for the same next one.
// Twenty readers, two passes; a thousand readers, still two.

export type CoalescedRefresh = {
  // Resolves once a pass that STARTED after this call has finished. Rejects
  // with whatever the pass rejected with; the caller decides whether a failed
  // reconcile is fatal.
  readonly refresh: () => Promise<void>
}

export const createCoalescedRefresh = (input: {
  readonly pass: () => Promise<void>
}): CoalescedRefresh => {
  const { pass } = input
  // The pass running right now, cleared when it settles.
  let inFlight: Promise<void> | undefined
  // The single follow-up every caller that arrived during `inFlight` shares.
  let queued: Promise<void> | undefined

  const begin = (): Promise<void> => {
    // `begin` is only ever reached with no pass in flight (see both call sites),
    // so this assignment can never clobber another pass's slot.
    const started = (async (): Promise<void> => {
      try {
        await pass()
      } finally {
        inFlight = undefined
      }
    })()
    inFlight = started
    return started
  }

  const refresh = (): Promise<void> => {
    const current = inFlight
    if (current === undefined) return begin()
    const alreadyQueued = queued
    if (alreadyQueued !== undefined) return alreadyQueued
    const next = (async (): Promise<void> => {
      // A rejected pass must not cancel the follow-up: these callers still need
      // a pass of their own, and they get the new one's outcome, not the old
      // one's failure.
      await current.catch(() => undefined)
      queued = undefined
      // Another caller may have started a pass in the gap between `current`
      // settling and this continuation running. That pass also began after
      // every caller waiting here called, so it satisfies them too.
      return inFlight ?? begin()
    })()
    queued = next
    return next
  }

  return { refresh }
}
