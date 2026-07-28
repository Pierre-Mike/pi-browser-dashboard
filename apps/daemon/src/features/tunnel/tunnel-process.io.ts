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
import { parseTunnelUrl, STOPPED, type TunnelState } from "./tunnel.core"

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

  let buffered = ""
  let resolved = false

  const settle = (next: TunnelState): TunnelState => {
    resolved = true
    setState(next)
    return next
  }

  const watch = (stream: ReadableStream<Uint8Array> | null): Promise<string | null> => {
    if (!stream) return Promise.resolve(null)
    return (async () => {
      const dec = new TextDecoder()
      const reader = stream.getReader()
      try {
        while (true) {
          const { value, done } = await reader.read()
          if (done) return null
          buffered += dec.decode(value, { stream: true })
          const url = parseTunnelUrl(buffered)
          if (url) return url
        }
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
  // stderr by default, so awaiting both would hang on the empty stdout.
  const urlPromise = Promise.race([
    watch(asStream(child.stdout)),
    watch(asStream(child.stderr)),
  ]).then((u) => u)
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
