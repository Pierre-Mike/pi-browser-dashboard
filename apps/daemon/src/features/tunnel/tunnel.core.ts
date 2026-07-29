/**
 * Pure helpers for the Cloudflare quick-tunnel feature.
 *
 * Parsing the trycloudflare URL out of cloudflared's log stream and deriving
 * its host are side-effect-free, so they live here and are unit-tested with
 * plain string fixtures. All subprocess I/O lives in tunnel-process.io.ts.
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

/**
 * How much prior output the URL watcher keeps between pipe reads.
 *
 * A quick-tunnel hostname is well under 100 characters, so a couple of hundred
 * is already generous for the only case that needs any history at all: a banner
 * split across two reads with the hostname straddling the boundary.
 */
export const URL_CARRY_CHARS = 256

/**
 * Keep only the last `maxChars` of `tail + chunk`.
 *
 * The watcher used to append every chunk to one string for the whole life of the
 * `cloudflared` child and re-run `parseTunnelUrl` over the entire accumulation
 * per chunk. cloudflared logs continuously (connection registrations, metrics),
 * so that buffer grew without bound and the scan grew with it — quadratic CPU on
 * the daemon's main thread and memory that is never reclaimed. Measured against
 * a deliberately chatty child: 96 MB buffered and 100% of a core within 20
 * seconds.
 *
 * Nothing about finding a URL needs more than the newest output, hence a bounded
 * carry rather than a growing buffer.
 */
export const carryTail = (input: {
  readonly tail: string
  readonly chunk: string
  readonly maxChars: number
}): string => {
  const combined = input.tail + input.chunk
  if (combined.length <= input.maxChars) return combined
  return combined.slice(combined.length - input.maxChars)
}

export type UrlScan = {
  readonly url: string | null
  /** What to carry into the next read. Never longer than `maxChars`. */
  readonly carry: string
}

/**
 * Scan one pipe read for the tunnel URL and return the bounded carry for the
 * next one.
 *
 * The ORDER matters and is the whole point: the scan sees `carry + chunk` in
 * full, and only what survives into the *next* read is truncated. Truncating
 * first loses URLs — a chatty cloudflared can deliver its banner and several KB
 * of connection logs in a single read, putting the hostname at the front of a
 * chunk whose tail carries nothing. That reads as "timed out waiting for tunnel
 * URL" with a perfectly healthy tunnel running.
 *
 * Cost is O(chunk) per read instead of O(everything logged so far), which is the
 * regression this replaces.
 */
export const scanForUrl = (input: {
  readonly carry: string
  readonly chunk: string
  readonly maxChars: number
}): UrlScan => {
  const text = input.carry + input.chunk
  return {
    url: parseTunnelUrl(text),
    carry: carryTail({ tail: "", chunk: text, maxChars: input.maxChars }),
  }
}

/** Lowercased host of a tunnel URL (for Host-header allowlisting), or null. */
export const tunnelHost = (url: string): string | null => {
  try {
    return new URL(url).host.toLowerCase()
  } catch {
    return null
  }
}
