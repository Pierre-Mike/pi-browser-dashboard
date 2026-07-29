/**
 * Cloudflare quick-tunnel subprocess manager (imperative shell).
 *
 * Owns the lifecycle of a single `cloudflared tunnel --url ...` child. Mirrors
 * the proven pier implementation: one tunnel per daemon process, concurrent
 * start() calls share the in-flight launch, stop() is idempotent, and the
 * child is monitored for unexpected exit. The child inherits the process
 * group, so a daemon crash takes the tunnel down with it. Pure parsing lives
 * in tunnel.core.ts.
 */
import type { Subprocess } from "bun"
import { STOPPED, scanForUrl, type TunnelState, URL_CARRY_CHARS } from "./tunnel.core"

const STARTUP_TIMEOUT_MS = 20_000

let proc: Subprocess | null = null
let state: TunnelState = STOPPED
let inflight: Promise<TunnelState> | null = null

export const getTunnelState = (): TunnelState => ({ ...state })

const setState = (next: TunnelState): void => {
  state = next
}

const launch = async (port: number): Promise<TunnelState> => {
  setState({ status: "starting", url: null })

  let child: Subprocess
  try {
    // No --http-host-header rewrite: keep the tunnel hostname intact so the
    // dashboard sees real Host headers (matches pier's behaviour).
    child = Bun.spawn(["cloudflared", "tunnel", "--url", `http://localhost:${port}`], {
      stdout: "pipe",
      stderr: "pipe",
    })
  } catch (err) {
    // Most commonly cloudflared isn't installed (ENOENT).
    proc = null
    const msg = err instanceof Error ? err.message : String(err)
    const next: TunnelState = {
      status: "error",
      url: null,
      error: `failed to spawn cloudflared (is it installed?): ${msg}`,
    }
    setState(next)
    return next
  }
  proc = child

  let resolved = false

  const settle = (next: TunnelState): TunnelState => {
    resolved = true
    setState(next)
    return next
  }

  /**
   * Read one of the child's pipes to completion, reporting the first tunnel URL
   * it sees through `onUrl`.
   *
   * Two things here are deliberate and were both real bugs:
   *
   *  - The loop does not stop once it has the URL, it keeps reading and
   *    discarding. cloudflared writes to stderr for as long as it runs, and a
   *    piped stream nobody reads is not free: Bun keeps draining the pipe into a
   *    buffer that nothing ever consumes, so RSS climbs for the daemon's whole
   *    life (measured: 41 MB to 254 MB in 15 seconds against a chatty child).
   *    Releasing the reader on success is what caused that, so success now only
   *    changes what the loop *does* with the bytes. `platform/shell.io.ts`
   *    drains its attach children for the same reason.
   *  - Only `URL_CARRY_CHARS` of history is carried between reads, per stream,
   *    instead of one ever-growing shared buffer re-scanned per chunk. See
   *    `scanForUrl`, which also explains why the scan has to precede the bound.
   */
  const watch = (input: {
    readonly stream: ReadableStream<Uint8Array> | null
    readonly onUrl: (url: string) => void
  }): Promise<void> => {
    const { stream, onUrl } = input
    if (!stream) return Promise.resolve()
    return (async () => {
      const dec = new TextDecoder()
      const reader = stream.getReader()
      let carry = ""
      let found = false
      try {
        while (true) {
          const { value, done } = await reader.read()
          if (done) return
          if (found) continue
          const scan = scanForUrl({
            carry,
            chunk: dec.decode(value, { stream: true }),
            maxChars: URL_CARRY_CHARS,
          })
          carry = scan.carry
          if (scan.url !== null) {
            found = true
            carry = ""
            onUrl(scan.url)
          }
        }
      } catch {
        // Pipe closed under us (child killed) — nothing left to drain.
      } finally {
        reader.releaseLock()
      }
    })()
  }

  // Bun types stdout/stderr as a union (number | ReadableStream | undefined);
  // under "pipe" they are streams. Narrow before watching.
  const asStream = (s: unknown): ReadableStream<Uint8Array> | null =>
    s instanceof ReadableStream ? s : null

  // Resolve as soon as EITHER stream surfaces a URL — cloudflared logs to
  // stderr by default, so awaiting both would hang on the empty stdout. The
  // watchers themselves keep running past this point to drain their pipes; only
  // the URL is raced.
  const urlPromise = new Promise<string>((resolveUrl) => {
    const onUrl = (url: string): void => resolveUrl(url)
    void watch({ stream: asStream(child.stdout), onUrl })
    void watch({ stream: asStream(child.stderr), onUrl })
  })
  const timeoutPromise = new Promise<null>((r) => setTimeout(() => r(null), STARTUP_TIMEOUT_MS))
  const exitPromise = child.exited.then(() => "EXITED" as const)

  const winner = await Promise.race([urlPromise, timeoutPromise, exitPromise])

  if (resolved) return state

  if (winner === "EXITED") {
    const code = await child.exited
    proc = null
    return settle({
      status: "error",
      url: null,
      error: `cloudflared exited (${code}) before reporting a URL`,
    })
  }
  if (!winner) {
    try {
      child.kill()
    } catch {
      /* already dead */
    }
    proc = null
    return settle({
      status: "error",
      url: null,
      error: `timed out waiting for tunnel URL after ${STARTUP_TIMEOUT_MS}ms`,
    })
  }

  // Background-monitor for unexpected exit.
  void child.exited.then(() => {
    if (proc === child) {
      proc = null
      if (state.status === "running") setState(STOPPED)
    }
  })

  return settle({ status: "running", url: winner })
}

export const startTunnel = async (port: number): Promise<TunnelState> => {
  if (state.status === "running") return state
  if (inflight) return inflight
  inflight = launch(port).finally(() => {
    inflight = null
  })
  return inflight
}

export const stopTunnel = async (): Promise<TunnelState> => {
  const child = proc
  if (!child) {
    setState(STOPPED)
    return state
  }
  try {
    child.kill()
  } catch {
    /* already dead */
  }
  await child.exited.catch(() => undefined)
  proc = null
  setState(STOPPED)
  return state
}
