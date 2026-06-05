/**
 * Pure host-allowlist policy for the Vite dev server (functional core).
 *
 * The daemon points its Cloudflare quick-tunnel at the web dev port (5173), so
 * the public URL serves this Vite server directly. Quick-tunnel hostnames are
 * random (`<random>.trycloudflare.com`) and rotate per boot, so they cannot be
 * pinned — we allow the whole `.trycloudflare.com` apex. A leading dot tells
 * Vite to match the domain and all its subdomains.
 *
 * Extra hosts (e.g. a named tunnel or a reverse proxy) can be added via the
 * comma-separated `PID_ALLOWED_HOSTS` env var. localhost/127.0.0.1 are always
 * accepted by Vite regardless of this list, so they are not included.
 */

/** Always allow Cloudflare quick-tunnel subdomains. */
export const TRYCLOUDFLARE_HOST = ".trycloudflare.com"

export const parseAllowedHosts = (env: Record<string, string | undefined> = {}): string[] => {
  const extra = (env.PID_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim())
    .filter((h) => h.length > 0)

  const all = [TRYCLOUDFLARE_HOST, ...extra]
  // Dedupe while preserving order.
  return [...new Set(all)]
}
