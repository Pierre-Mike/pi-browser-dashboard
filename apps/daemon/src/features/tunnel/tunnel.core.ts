/**
 * Pure helpers for the Cloudflare quick-tunnel feature.
 *
 * Parsing the trycloudflare URL out of cloudflared's log stream and deriving
 * its host are side-effect-free, so they live here and are unit-tested with
 * plain string fixtures. All subprocess I/O lives in tunnel.process.ts.
 */

export type TunnelStatus = "stopped" | "starting" | "running" | "error"

export interface TunnelState {
  readonly status: TunnelStatus
  readonly url: string | null
  readonly error?: string
}

export const STOPPED: TunnelState = { status: "stopped", url: null }

// Quick-tunnel hostnames look like https://<random-slug>.trycloudflare.com.
const URL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/

/** First trycloudflare URL in a buffered chunk of cloudflared output, or null. */
export const parseTunnelUrl = (buffered: string): string | null =>
  buffered.match(URL_RE)?.[0] ?? null

/** Lowercased host of a tunnel URL (for Host-header allowlisting), or null. */
export const tunnelHost = (url: string): string | null => {
  try {
    return new URL(url).host.toLowerCase()
  } catch {
    return null
  }
}
